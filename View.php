<?php

namespace TypechoPlugin\AlbumWall;

use Widget\Options;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 前台展示的数据与格式化工具。
 *
 * 页面上所有要显示的东西都从这里拿，模板文件只负责摆位置——这样配色、排序、
 * 兜底逻辑都只有一份。
 */
final class View
{
    private static ?array $albums = null;

    private static ?array $settings = null;

    private static ?string $pluginUrl = null;

    /**
     * 插件配置（未配置时回落到默认值）。
     *
     * @return array<string, mixed>
     */
    public static function settings(): array
    {
        if (self::$settings === null) {
            try {
                self::$settings = Plugin::settings();
            } catch (\Throwable $e) {
                self::$settings = Plugin::defaults();
            }
        }

        return self::$settings;
    }

    /**
     * 全部相册。
     *
     * @return array<int, array<string, mixed>>
     */
    public static function albums(): array
    {
        if (self::$albums === null) {
            try {
                self::$albums = Query::albums();
            } catch (\Throwable $e) {
                self::$albums = [];
            }
        }

        return self::$albums;
    }

    /**
     * 页面标题。
     */
    public static function title(): string
    {
        $title = trim((string) (self::settings()['pageTitle'] ?? ''));

        return $title === '' ? _t('相册') : $title;
    }

    /**
     * 当前配色档位，写进 .aw-app 的 data-aw-theme。
     */
    public static function flavor(): string
    {
        return Theme::flavor();
    }

    /**
     * 相册总数，用于页面副标题。
     */
    public static function count(): int
    {
        return count(self::albums());
    }

    /**
     * 所有相册里的图片总数，用于页面副标题。
     */
    public static function photoCount(): int
    {
        $total = 0;

        foreach (self::albums() as $album) {
            $total += (int) $album['count'];
        }

        return $total;
    }

    /**
     * 插件的静态资源地址，带一个基于文件修改时间的版本号。
     *
     * 用 filemtime 而不是写死的版本号，是为了改完 CSS/JS 刷新就能看到效果，
     * 不会被浏览器缓存骗到——这个页面调样式的时候会来回改很多次。
     */
    public static function asset(string $path): string
    {
        if (self::$pluginUrl === null) {
            try {
                self::$pluginUrl = rtrim((string) Options::alloc()->pluginUrl, '/');
            } catch (\Throwable $e) {
                self::$pluginUrl = '';
            }
        }

        $path = ltrim($path, '/');
        $file = __DIR__ . '/' . $path;
        $version = is_file($file) ? (string) filemtime($file) : '1';

        return self::$pluginUrl . '/' . Plugin::NAME . '/' . $path . '?v=' . $version;
    }

    /**
     * HTML 转义。
     *
     * @param mixed $value
     */
    public static function escape($value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }

    /**
     * 渲染相册墙的主体内容。
     *
     * @param array<string, mixed> $options 传 title 覆盖标题文案，传 false 则不输出标题
     */
    public static function wall(array $options = []): void
    {
        $wallTitle = array_key_exists('title', $options) ? $options['title'] : self::title();
        $albums = self::albums();
        $flavor = self::flavor();
        $app = self::settings();

        require __DIR__ . '/template/album.php';
    }

    /**
     * 供 JS 读取的相册数据。
     *
     * 只输出卡片上没有、JS 又确实需要的东西：标题、封面、原文链接、图片列表。
     * 网格里的标题、日期、张数都是服务端直接渲染的，首屏不依赖 JS；详情面板里
     * 那三段文字也是从卡片 DOM 上照抄的（见 album.js 的 fill），所以这里不再
     * 重复输出一份——两份字符串只要有一处对不上，替身落位就会看出来。
     *
     * 转义交给模板里的 json_encode 处理。
     *
     * @return array<int, array<string, mixed>>
     */
    public static function payload(): array
    {
        $payload = [];

        foreach (self::albums() as $album) {
            $payload[(string) $album['cid']] = [
                'title'     => (string) $album['title'],
                'cover'     => (string) ($album['cover'] ?? ''),
                'permalink' => (string) $album['permalink'],
                // 详情里的照片列表不含封面——封面在标题下方单独占一块大图，
                // 正文第一张再重复列一遍就是同一张图出现两次
                'photos'    => array_values($album['photos']),
            ];
        }

        return $payload;
    }
}
