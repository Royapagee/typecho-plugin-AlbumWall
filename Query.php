<?php

namespace TypechoPlugin\AlbumWall;

use Typecho\Date;
use Typecho\Db;
use Typecho\Router;
use Widget\Options;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 相册数据的取数层：按标签把文章查出来，给每篇算好封面和图片列表。
 *
 * 标签是可多选的，命中任意一个标签的文章都会进来，同一篇文章只出现一次。
 *
 * 只用 Typecho 自带的四张表（contents / relationships / metas），不建表、不写库
 * ——相册是对既有文章的一种视图，没有自己的数据。
 *
 * 封面规则：取正文第一张图。正文里没有图 → 按配置跳过这篇，或者留一张占位卡片。
 */
final class Query
{
    /**
     * 请求内缓存。同一页面里模板和外壳探测可能都来问一次，不缓存会查两遍。
     *
     * @var array<int, array<string, mixed>>|null
     */
    private static ?array $albums = null;

    /**
     * 全部相册，已按配置排序。
     *
     * 任何异常都吞掉返回空数组——相册页崩了不该把主题页面一起带走，
     * 页面上顶多是一片空白。
     *
     * @return array<int, array<string, mixed>>
     */
    public static function albums(): array
    {
        if (self::$albums === null) {
            try {
                self::$albums = self::load();
            } catch (\Throwable $e) {
                self::$albums = [];
            }
        }

        return self::$albums;
    }

    /**
     * 清掉请求内缓存（测试和后台改配置后用）。
     */
    public static function reset(): void
    {
        self::$albums = null;
    }

    /**
     * 真正干活的那个。
     *
     * @return array<int, array<string, mixed>>
     */
    private static function load(): array
    {
        $settings = Plugin::settings();

        $slugs = (array) $settings['tagSlugs'];
        if ($slugs === []) {
            return [];
        }

        $db = Db::get();
        $now = time();

        $select = $db->select(
            'table.contents.cid',
            'table.contents.title',
            'table.contents.created',
            'table.contents.text'
        )
            ->from('table.contents')
            ->join('table.relationships', 'table.contents.cid = table.relationships.cid')
            ->join('table.metas', 'table.metas.mid = table.relationships.mid')
            ->where('table.metas.type = ?', 'tag')
            ->where('table.metas.slug IN ?', $slugs)
            ->where('table.contents.type = ?', 'post')
            // 没有 status 这道坎的话，文章的 revision 会一起冒出来，相册里
            // 就会出现两个标题、日期、图片数完全一样的条目
            ->where('table.contents.status = ?', 'publish')
            // 定时发布的文章 status 也是 publish，靠 created 卡住
            ->where('table.contents.created < ?', $now)
            // 加密文章的图片不该漏进相册。password 的默认值是 NULL 而不是空串，
            // 只写 = '' 会把绝大多数正常文章一起滤掉
            ->where('table.contents.password IS NULL OR table.contents.password = ?', '')
            // 一篇同时挂着「摄影」和「旅游」的文章会被 JOIN 带出两行，相册里就是
            // 两张一模一样的卡片。metas 是多选后才真正会重复的，单选时命中一行而已。
            // 这是 Typecho 自己在分类多选里用的写法（Widget\Archive 的 mid IN 那段）
            ->group('table.contents.cid');

        self::applyOrder($select, (string) $settings['orderBy']);

        $rows = $db->fetchAll($select);

        if ($rows === []) {
            return [];
        }

        $baseUrl = self::siteUrl();
        $hideEmpty = (string) $settings['hideEmpty'] === '1';

        $albums = [];

        foreach ($rows as $row) {
            $album = self::build($row, $baseUrl);

            // 一张图都没有的相册没有展示价值，默认跳过
            if ($album['cover'] === null && $hideEmpty) {
                continue;
            }

            $albums[] = $album;
        }

        return $albums;
    }

    /**
     * 按配置拼 ORDER BY。
     */
    private static function applyOrder(\Typecho\Db\Query $select, string $orderBy): void
    {
        switch ($orderBy) {
            case 'created_asc':
                $select->order('table.contents.created', Db::SORT_ASC);
                break;
            case 'title_asc':
                $select->order('table.contents.title', Db::SORT_ASC);
                break;
            case 'title_desc':
                $select->order('table.contents.title', Db::SORT_DESC);
                break;
            case 'created_desc':
            default:
                $select->order('table.contents.created', Db::SORT_DESC);
                break;
        }
    }

    /**
     * 把一行内容加工成相册结构。
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function build(array $row, string $baseUrl): array
    {
        $cid = (int) $row['cid'];
        $created = (int) $row['created'];
        $text = (string) ($row['text'] ?? '');

        $images = Extract::images($text, $baseUrl);

        // 封面就是正文第一张，正文里那张就不再重复列一遍
        $cover = $images[0] ?? null;
        $photos = array_slice($images, 1);

        return [
            'cid'       => $cid,
            'title'     => (string) ($row['title'] ?? ''),
            'permalink' => self::permalink($cid),
            'created'   => $created,
            // 只有一种日期格式：卡片和详情显示的是同一串字，展开时那一段文字
            // 才可能原样飞过去（两边格式不同的话，替身的宽度和真身对不上）
            'date'      => self::date($created, 'Y-m-d'),
            'cover'     => $cover,
            'photos'    => $photos,
            'count'     => count($images),
        ];
    }

    /**
     * 文章永久链接。
     *
     * 走 Router 而不是自己拼 /archives/{cid}/，这样站主以后改固定链接结构，
     * 相册里的「阅读原文」会跟着变。
     */
    private static function permalink(int $cid): string
    {
        try {
            $url = Router::url('post', ['cid' => $cid], (string) Options::alloc()->index);

            // 路由表还没初始化时 url() 会返回 '#'，那就干脆不给链接
            return $url === '#' ? '' : $url;
        } catch (\Throwable $e) {
            return '';
        }
    }

    /**
     * 按站点时区格式化时间戳。
     *
     * 直接用 date() 会按服务器时区走，和站内其它地方显示的时间对不上。
     */
    private static function date(int $timestamp, string $format): string
    {
        try {
            return (new Date($timestamp))->format($format);
        } catch (\Throwable $e) {
            return date($format, $timestamp);
        }
    }

    /**
     * 站点地址，用来把正文里的 /usr/uploads/... 补成绝对地址。
     */
    private static function siteUrl(): string
    {
        try {
            return (string) Options::alloc()->siteUrl;
        } catch (\Throwable $e) {
            return '';
        }
    }
}
