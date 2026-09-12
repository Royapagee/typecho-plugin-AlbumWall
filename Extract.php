<?php

namespace TypechoPlugin\AlbumWall;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 从文章正文里提取图片地址。
 *
 * 有意做成纯函数（不碰数据库、不依赖 Options），方便单独验证：只要把一段正文
 * 和一个 baseUrl 丢进来就该拿到一串绝对地址。
 *
 * 一个刻意的取舍：提取的是**原始 text 列**，不是 $this->content。后者会跑一遍
 * markdown 解析和 contentEx 过滤器链，等于为了拿几个图片地址把站上所有内容类
 * 插件都拖下水；而原始 text 里 markdown 和 HTML 两种写法都是明文，正则足够。
 */
final class Extract
{
    /**
     * 一条正则同时匹配两种写法，靠分组区分。
     *
     * 之所以合在一起而不是分两趟 preg_match_all，是因为要保住图片在正文里的
     * **先后顺序**——封面取的是第一张，分两趟跑就分不出谁在前了。
     *
     *  - 分组 1：markdown 的尖括号写法 ![alt](<带空格的地址>)
     *  - 分组 2：markdown 的普通写法 ![alt](url)
     *  - 分组 3：HTML 的 <img src="...">
     *
     * 分组 3 里的 (?<![\w-]) 是为了不把 data-src / lazy-src 这类懒加载属性
     * 当成 src——`-` 和 `s` 之间存在单词边界，光写 \bsrc 是拦不住的。
     */
    private const IMAGE = '/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))'
        . '|<img\b[^>]*?(?<![\w\-])src\s*=\s*["\']([^"\']+)["\']/i';

    /**
     * 围栏代码块。教程类文章里常整段贴示例代码，里面的图片语法不该被当成真图。
     */
    private const FENCE = '/^[ \t]*(?:```|~~~).*?^[ \t]*(?:```|~~~)[ \t]*$/ms';

    /**
     * 提取正文里的全部图片，按出现顺序去重。
     *
     * @param string $text 文章原始正文
     * @param string $baseUrl 站点地址，用于把 /usr/uploads/... 补成绝对地址
     * @return array<int, string>
     */
    public static function images(string $text, string $baseUrl = ''): array
    {
        if ($text === '') {
            return [];
        }

        // 先摘掉代码块再匹配，避免误伤
        $body = (string) preg_replace(self::FENCE, '', $text);

        if (!preg_match_all(self::IMAGE, $body, $matches, PREG_SET_ORDER)) {
            return [];
        }

        $images = [];

        foreach ($matches as $match) {
            // 三个分组里只有一个非空，按优先级取第一个有值的
            $raw = $match[1] ?? '';
            if ($raw === '') {
                $raw = $match[2] ?? '';
            }
            if ($raw === '') {
                $raw = $match[3] ?? '';
            }

            $url = self::normalize($raw, $baseUrl);

            if ($url !== null && !in_array($url, $images, true)) {
                $images[] = $url;
            }
        }

        return $images;
    }

    /**
     * 只取第一张，取不到返回 null。
     */
    public static function first(string $text, string $baseUrl = ''): ?string
    {
        $images = self::images($text, $baseUrl);

        return $images[0] ?? null;
    }

    /**
     * 把图片地址规范化成可直接写进 src 的绝对地址。
     *
     * 认不出来的返回 null —— 宁可这张图不显示，也不要往页面里塞一个裂图地址。
     */
    public static function normalize(string $url, string $baseUrl = ''): ?string
    {
        $url = trim($url, " \t\n\r\0\x0B\"'");

        if ($url === '') {
            return null;
        }

        // data: 是内嵌图片，当封面会把整页撑爆；javascript: 更不能留
        if (preg_match('#^[a-z][a-z0-9+.\-]*:#i', $url)) {
            return preg_match('#^https?://#i', $url) ? $url : null;
        }

        // 协议相对地址，站点是 https 时跟着走 https
        if (str_starts_with($url, '//')) {
            return 'https:' . $url;
        }

        // 站内绝对路径
        if (str_starts_with($url, '/')) {
            $base = trim($baseUrl, '/');

            // baseUrl 形如 http://host/blog，这里只需要 http://host 这一段
            if (preg_match('#^(https?://[^/]+)#i', $base, $m)) {
                return $m[1] . $url;
            }

            return null;
        }

        // 相对路径（foo.jpg、../img/a.png）含义取决于当前页面地址，对相册来说
        // 无法可靠还原，直接放弃
        return null;
    }
}
