<?php

namespace TypechoPlugin\AlbumWall;

use Widget\Options;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 当前主题的判定，用于决定相册墙走哪一档配色。
 *
 * 分两档：
 *  - jasmine：模板上打 data-aw-theme="jasmine"，样式表改读 Jasmine 的私有变量
 *    （--link-color-rgba / --primary-color-rgba / --bg-auto-rgb …）
 *  - default：其它主题，样式表只依赖 Bootstrap 的 --bs-* 变量，再回落到插件自带色值
 *
 * 这里刻意只做判定，不掺任何取色逻辑。原因是 Jasmine 存在 Typecho 里的主题配置
 * （options 表的 theme:Jasmine 行）只有 logoUrl / categoryNum / customHead /
 * customFooter，一个颜色值都没有；它的调色板写在 assets/main/main.css 的 CSS
 * 变量里，PHP 这侧读不到。所以取色只能交给 CSS 的 var() 回退链去做。
 *
 * 附带的好处：Jasmine 的深浅色是同一套变量名换值，相册跟着它自动适配深色模式。
 */
final class Theme
{
    /** Jasmine 配色档位标记 */
    public const JASMINE = 'jasmine';

    /** 其它主题的兜底配色档位标记 */
    public const DEFAULT_FLAVOR = 'default';

    /**
     * 请求内缓存，避免反复查 Options
     */
    private static ?string $flavor = null;

    /**
     * 当前站点该用哪一档配色，直接写进 .aw-app 的 data-aw-theme 属性。
     */
    public static function flavor(): string
    {
        if (self::$flavor === null) {
            self::$flavor = self::flavorFor(self::name());
        }

        return self::$flavor;
    }

    /**
     * 主题名 → 配色档位。
     */
    public static function flavorFor(string $themeName): string
    {
        return self::isJasmine($themeName) ? self::JASMINE : self::DEFAULT_FLAVOR;
    }

    /**
     * 判断给定主题（默认取当前启用的主题）是不是 Jasmine 系。
     *
     * @param string|null $themeName 为空时读取当前启用的主题
     */
    public static function isJasmine(?string $themeName = null): bool
    {
        $themeName ??= self::name();

        if ($themeName === '') {
            return false;
        }

        $dir = self::dirFor($themeName);

        // 硬特征优先：Jasmine 的调色板就写在 assets/main/main.css 的 CSS 变量里，
        // 拿不到这套变量却按 Jasmine 档取色只会串色。
        //
        // 所以名字只是"或"的一边，不能单独成立：叫 jasmine-dark 的主题未必是
        // Jasmine 系，光看前缀就判 true 的话，深色站会拿到近黑色的文字回退，
        // 压在深色卡片上就是一片看不清。
        if (!is_file($dir . 'assets/main/main.css')) {
            return false;
        }

        // 主题目录可能被改名（例如 Jasmine_Plus），所以用前缀匹配而不是全等；
        // 改得连名字都不沾边时，只要模板部件还是 Jasmine 的摆法也认。
        return stripos($themeName, 'jasmine') === 0
            || is_file($dir . 'template-parts/navbar.php');
    }

    /**
     * 当前启用的主题名，取不到时返回空串（当作非 Jasmine 处理）。
     */
    public static function name(): string
    {
        try {
            return (string) (Options::alloc()->theme ?? '');
        } catch (\Throwable $e) {
            return '';
        }
    }

    /**
     * 当前主题目录的绝对路径，带结尾斜杠；取不到时返回空串。
     */
    public static function dir(): string
    {
        return self::dirFor(self::name());
    }

    /**
     * 指定主题目录的绝对路径，带结尾斜杠；主题不存在时返回空串。
     */
    private static function dirFor(string $themeName): string
    {
        if ($themeName === '') {
            return '';
        }

        try {
            // themeFile() 会做 trim($theme, './') 并拼上主题目录，不用自己拼路径
            $dir = (string) Options::alloc()->themeFile($themeName);
        } catch (\Throwable $e) {
            return '';
        }

        return rtrim($dir, '/\\') . '/';
    }
}
