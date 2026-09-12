<?php

namespace TypechoPlugin\AlbumWall;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 相册页的「主题外壳」装配。
 *
 * 独立页面模板要被复制进主题目录，但它不能假设主题长什么样。这里把「找部件 +
 * 按顺序拼装」收成一份：部件按候选路径依次探测，覆盖两种常见摆放——
 *  - Jasmine 这类把部件集中放在 template-parts/ 下的主题
 *  - Typecho 默认主题这类把 header.php / footer.php 放在主题根目录的主题
 *
 * 主题一个都没提供时退回插件自带的简易外壳（template/shell-*.php），页面仍然可用。
 */
final class Chrome
{
    /**
     * 主题部件候选表：键是部件名，值是按优先级排列的候选相对路径。
     */
    private const PARTS = [
        'header' => ['template-parts/header.php', 'header.php'],
        'left'   => ['template-parts/left.php'],
        'right'  => ['template-parts/right.php'],
        'footer' => ['template-parts/footer.php', 'footer.php'],
        'navbar' => ['template-parts/navbar.php'],
    ];

    /**
     * 探测主题提供了哪些部件。
     *
     * themeChrome 表示能套上主题外壳（header 与 footer 都在）；sidebar 表示主题
     * 有左侧栏，正文要按两栏结构收进 #middle。
     *
     * @param string $themeDir 主题目录（绝对路径，结尾斜杠可有可无）
     * @return array<string, mixed> header / left / right / footer / navbar 为相对路径或 null
     */
    public static function detect(string $themeDir): array
    {
        $themeDir = rtrim($themeDir, '/\\') . '/';
        $parts = [];

        foreach (self::PARTS as $name => $candidates) {
            $parts[$name] = null;

            foreach ($candidates as $candidate) {
                if (is_file($themeDir . $candidate)) {
                    $parts[$name] = $candidate;
                    break;
                }
            }
        }

        $parts['themeChrome'] = $parts['header'] !== null && $parts['footer'] !== null;
        $parts['sidebar'] = $parts['themeChrome'] && $parts['left'] !== null;

        return $parts;
    }

    /**
     * 渲染整页：主题外壳 + 相册墙 + 主题外壳。
     *
     * $need 由调用方提供，用来载入主题模板文件（相对主题目录）。之所以不在这里
     * 直接 require，是因为主题模板里到处都是 $this->need() / $this->options，
     * 必须让文件在调用方那个 Widget 对象的作用域里执行。
     *
     * @param string $themeDir 主题目录（绝对路径）
     * @param callable(string): void $need 载入主题模板文件
     * @param string|null $heading 页面标题；为空时用插件设置里的「页面标题」
     */
    public static function render(string $themeDir, callable $need, ?string $heading = null): void
    {
        $parts = self::detect($themeDir);

        // 这几个变量是给 template/album.php 用的（require 共享作用域）
        $awThemeChrome = $parts['themeChrome'];
        $awHasSidebar = $parts['sidebar'];
        $awNavbar = $awThemeChrome ? $parts['navbar'] : null;
        $awHeading = $heading;

        if (!$awThemeChrome) {
            // 主题没有成对的 header / footer，退回插件自带的简易外壳
            require __DIR__ . '/template/shell-header.php';
        } else {
            $need($parts['header']);

            if ($parts['left'] !== null) {
                $need($parts['left']);
            }
        }

        require __DIR__ . '/template/album.php';

        if ($awThemeChrome) {
            if ($parts['right'] !== null) {
                $need($parts['right']);
            }

            $need($parts['footer']);
        } else {
            require __DIR__ . '/template/shell-footer.php';
        }
    }
}
