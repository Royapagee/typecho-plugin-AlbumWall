<?php
/**
 * 相册页面
 *
 * @package custom
 *
 * 用法：把本文件复制到主题目录（例如 usr/themes/Jasmine/），然后在
 * 「管理 → 独立页面」新增页面时，把「自定义模板」选成「相册」。
 *
 * 注意 @package custom 必须紧跟在标题后面——Typecho 的 Plugin::parseInfo()
 * 会把第一个 @ 行之前的全部内容当成模板名，中间插正文的话，后台那个下拉框
 * 会显示成一大段文字。所以下面这些说明只能放在 @package 之后。
 *
 * 主题外壳（header / 侧栏 / 导航栏 / footer）由插件按候选路径自动探测，
 * template-parts/ 与主题根目录两种摆法都认，所以换主题不用改这个文件。
 * 相册墙本身、以及配色档位（Jasmine / 其它主题）都在插件里。
 *
 * 本页显示哪些相册由插件设置里的「相册标签」决定，和这个页面本身无关。
 */

use Typecho\Plugin as CorePlugin;
use TypechoPlugin\AlbumWall\Chrome;

if (!defined('__TYPECHO_ROOT_DIR__')) exit;

/*
 * 插件不可用时退回主题自己的独立页面模板，至少页面结构是完整的。
 *
 * 两个条件缺一不可：
 *  - class_exists：Typecho 的自动加载是按文件路径来的，插件目录被删掉时类才不存在
 *  - CorePlugin::exists：自动加载不反映启用状态，插件停用后类照样能加载出来，
 *    得单独问一句，否则停用了插件相册墙还在渲染
 */
if (!class_exists(Chrome::class) || !CorePlugin::exists('AlbumWall')) {
    $themeDir = rtrim((string) $this->getThemeDir(), '/\\') . '/';

    if (is_file($themeDir . 'page.php')) {
        $this->need('page.php');
    } else {
        _e('请先启用 AlbumWall 插件，相册才能正常显示。');
    }

    return;
}

// $this 是当前独立页面的 Widget\Archive。主题模板必须在它的作用域里载入，
// 里面的 $this->need() / $this->options 才能正常工作，所以这里把 $this->need
// 作为回调交给 Chrome，而不是让 Chrome 自己去 require。
Chrome::render(
    (string) $this->getThemeDir(),
    fn(string $file) => $this->need($file),
    (string) $this->title
);
