<?php

namespace TypechoPlugin\AlbumWall;

use Typecho\Db;
use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;
use Typecho\Widget\Helper\Form\Element\Hidden;
use Typecho\Widget\Helper\Form\Element\Select;
use Typecho\Widget\Helper\Form\Element\Text;
use Widget\Options;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 把指定标签下的文章聚合成一面相册墙，提供一个页面模板集中展示。
 *
 * @package AlbumWall
 * @author 罗伊
 * @version 1.0.0
 * @link https://github.com/Royapagee
 */
final class Plugin implements PluginInterface
{
    /**
     * 插件名。必须与插件目录名、命名空间末段完全一致，Typecho 靠这三个名字
     * 互相定位，改动时三处要一起改，且改完要清 options 里残留的 routingTable /
     * panelTable 旧类名：
     *  - 自动加载：TypechoPlugin\AlbumWall\Plugin → usr/plugins/AlbumWall/Plugin.php
     *  - 插件配置：options 表中以 plugin:AlbumWall 为键存取
     */
    public const NAME = 'AlbumWall';

    /**
     * 主题里那份独立页面模板的文件名，activate() 的提示里会用到
     */
    public const THEME_TEMPLATE = 'page-album.php';

    /**
     * 配置项的默认值。
     *
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'tagSlug'    => 'Photo',
            'coverField' => 'thumbnail',
            'pageTitle'  => '相册',
            'orderBy'    => 'created_desc',
            'hideEmpty'  => '1',
        ];
    }

    /**
     * 读取插件配置，未配置的项回落到默认值。
     *
     * @return array<string, mixed>
     */
    public static function settings(): array
    {
        $saved = [];

        try {
            $saved = Options::alloc()->plugin(self::NAME)->toArray();
        } catch (\Throwable $e) {
            // 插件尚未配置时 Options::plugin() 会抛异常，这里静默回落到默认值
        }

        $settings = array_merge(self::defaults(), is_array($saved) ? $saved : []);

        // 表单里被清空的项会以空字符串保存，空值一律回落到默认值
        foreach ($settings as $key => $value) {
            if ($value === null || $value === '') {
                $settings[$key] = self::defaults()[$key] ?? '';
            }
        }

        return $settings;
    }

    /**
     * 激活插件。
     *
     * 这里不需要注册路由、建表或写库——相册是对既有文章的一种视图。返回值会被
     * Typecho 当作提示信息展示，正好用来提示还差哪一步。
     *
     * @return string
     */
    public static function activate()
    {
        $themeDir = Theme::dir();

        if ($themeDir !== '' && !is_file($themeDir . self::THEME_TEMPLATE)) {
            return _t(
                '插件已启用。还差一步：把 usr/plugins/%s/theme/%s 复制到主题目录 %s，'
                . '再新建一个独立页面，把「自定义模板」选成「相册」。',
                self::NAME,
                self::THEME_TEMPLATE,
                $themeDir
            );
        }

        return _t('插件已启用，相册页面可以正常显示了。');
    }

    /**
     * 停用插件。
     *
     * 没有路由、菜单、面板或自建表要清理，配置留在 options 里，重新启用即可复原。
     */
    public static function deactivate(): void
    {
    }

    /**
     * 构建插件配置表单。
     */
    public static function config(Form $form): void
    {
        self::addTagInput($form);

        $form->addInput(
            new Text(
                'coverField',
                null,
                self::defaults()['coverField'],
                _t('封面自定义字段'),
                _t(
                    '在该字段里填图片地址，相册就用这张图做封面；留空、填 1 或填 0 都表示'
                    . '「从正文提取第一张图」。沿用 Jasmine 主题的 thumbnail 字段即可。'
                )
            )
        );

        $form->addInput(
            new Text(
                'pageTitle',
                null,
                self::defaults()['pageTitle'],
                _t('页面标题'),
                _t('相册墙上方的标题。若在独立页面模板里已经被页面自身的标题占用，这里只作兜底。')
            )
        );

        $form->addInput(
            new Select(
                'orderBy',
                [
                    'created_desc' => _t('发布时间（新的在前）'),
                    'created_asc'  => _t('发布时间（旧的在前）'),
                    'title_asc'    => _t('标题（A → Z）'),
                    'title_desc'   => _t('标题（Z → A）'),
                ],
                self::defaults()['orderBy'],
                _t('相册排序')
            )
        );

        $form->addInput(
            new Select(
                'hideEmpty',
                [
                    '1' => _t('跳过（推荐）'),
                    '0' => _t('显示为占位卡片'),
                ],
                self::defaults()['hideEmpty'],
                _t('没有图片的文章'),
                _t('正文和自定义字段里都没有图片时如何处理。')
            )
        );

        self::addLegacyInputs($form);
    }

    /**
     * 插件未提供个人配置项，这里保留空实现以符合接口约定。
     */
    public static function personalConfig(Form $form): void
    {
    }

    /**
     * 标签选择框。
     *
     * 优先做成下拉框而不是自由输入：标签 slug 打错一个字母，前台就是一片空白，
     * 而且没有任何提示——这是这个插件最容易踩的坑，能靠 UI 堵掉就堵掉。
     */
    private static function addTagInput(Form $form): void
    {
        $tags = self::tagOptions();
        $default = (string) self::defaults()['tagSlug'];
        $saved = self::savedValue('tagSlug');

        // 站上一个标签都没有（或查库失败）时退回文本框
        if ($tags === []) {
            $form->addInput(
                (new Text(
                    'tagSlug',
                    null,
                    $saved !== '' ? $saved : $default,
                    _t('相册标签'),
                    _t('填写标签的缩略名（slug），例如 Photo。注意是缩略名不是显示名，站上还没有标签时只能手填。')
                ))->addRule('required', _t('相册标签不能为空'))
            );

            return;
        }

        // 已保存的标签可能已经被删掉了。Select 里没有匹配项时浏览器会默认选中
        // 第一项，保存一下就悄悄把配置改成了别的标签，所以得把它补回选项里。
        if ($saved !== '' && !isset($tags[$saved])) {
            $tags = [$saved => _t('%s（该标签已不存在，请重新选择）', $saved)] + $tags;
        }

        if (!isset($tags[$default])) {
            $tags[$default] = $default;
        }

        $form->addInput(
            new Select(
                'tagSlug',
                $tags,
                $saved !== '' ? $saved : $default,
                _t('相册标签'),
                _t('哪些标签下的文章会被聚合成相册。')
            )
        );
    }

    /**
     * 站上的标签列表，用作下拉框选项。
     *
     * @return array<string, string> [slug => 显示文案]
     */
    private static function tagOptions(): array
    {
        try {
            $db = Db::get();

            $rows = $db->fetchAll(
                $db->select('table.metas.slug', 'table.metas.name', 'table.metas.count')
                    ->from('table.metas')
                    ->where('table.metas.type = ?', 'tag')
                    ->order('table.metas.count', Db::SORT_DESC)
            );
        } catch (\Throwable $e) {
            return [];
        }

        $options = [];

        foreach ($rows as $row) {
            $slug = trim((string) $row['slug']);

            if ($slug === '') {
                continue;
            }

            $options[$slug] = _t(
                '%s（%s，%d 篇）',
                (string) $row['name'],
                $slug,
                (int) $row['count']
            );
        }

        return $options;
    }

    /**
     * 读一项已保存的配置，读不到返回空串。
     */
    private static function savedValue(string $key): string
    {
        try {
            $saved = Options::alloc()->plugin(self::NAME)->toArray();
        } catch (\Throwable $e) {
            return '';
        }

        return is_array($saved) ? trim((string) ($saved[$key] ?? '')) : '';
    }

    /**
     * 为历史版本里残留、当前表单已不再提供的配置项补一个隐藏字段。
     *
     * Typecho 渲染插件设置页时，会把已保存的每个配置项回填到表单上
     * （Widget\Plugins\Config 里 `$form->getInput($key)->value($val)`），
     * 而 Form::getInput() 没有做空值保护——只要某个已保存的键在当前表单里
     * 找不到对应元素，设置页就会直接 500，且用户无法通过保存来自救。
     *
     * 所以这里把「已保存但表单没有」的键补成隐藏字段，让旧配置可以平滑降级。
     */
    private static function addLegacyInputs(Form $form): void
    {
        try {
            $saved = Options::alloc()->plugin(self::NAME)->toArray();
        } catch (\Throwable $e) {
            return;
        }

        if (!is_array($saved)) {
            return;
        }

        // 这里用 getInputs() 取全部字段再比对，避免直接调 getInput() 触发未定义键的警告
        $existing = $form->getInputs();

        foreach (array_keys($saved) as $key) {
            $key = (string) $key;
            if (!array_key_exists($key, $existing)) {
                $form->addInput(new Hidden($key, null, '', null));
            }
        }
    }
}
