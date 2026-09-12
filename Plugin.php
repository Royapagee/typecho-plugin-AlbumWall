<?php

namespace TypechoPlugin\AlbumWall;

use Typecho\Db;
use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;
use Typecho\Widget\Helper\Form\Element\Checkbox;
use Typecho\Widget\Helper\Form\Element\Hidden;
use Typecho\Widget\Helper\Form\Element\Select;
use Typecho\Widget\Helper\Form\Element\Text;
use Typecho\Widget\Helper\Layout;
use Widget\Options;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/**
 * 把指定标签下的文章聚合成一面相册墙，提供一个页面模板集中展示。
 *
 * @package AlbumWall
 * @author 罗伊
 * @version 2.0.0
 * @link https://github.com/Royapagee/typecho-plugin-AlbumWall
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
            // 多值项，存的是 slug 数组
            'tagSlugs'  => ['Photo'],
            'pageTitle' => '相册',
            'orderBy'   => 'created_desc',
            'hideEmpty' => '1',
        ];
    }

    /**
     * 读取插件配置，未配置的项回落到默认值。
     *
     * @return array<string, mixed>
     */
    public static function settings(): array
    {
        $defaults = self::defaults();
        $saved = self::rawSaved();

        $settings = array_merge($defaults, $saved);

        // tagSlugs 是多值项，得单独解析。下面那条「空值回落默认」的规则会把
        // 「一个标签都没勾」当成「没配置过」而塞回默认标签，对多值项是错的
        $settings['tagSlugs'] = self::resolveTagSlugs($saved);

        // 表单里被清空的项会以空字符串保存，空值一律回落到默认值
        foreach ($settings as $key => $value) {
            if ($key === 'tagSlugs') {
                continue;
            }

            if ($value === null || $value === '') {
                $settings[$key] = $defaults[$key] ?? '';
            }
        }

        return $settings;
    }

    /**
     * 读插件在 options 表里的原始配置数组，未配置或读库失败时返回空数组。
     *
     * @return array<string, mixed>
     */
    private static function rawSaved(): array
    {
        try {
            $saved = Options::alloc()->plugin(self::NAME)->toArray();
        } catch (\Throwable $e) {
            // 插件尚未配置时 Options::plugin() 会抛异常，这里静默回落到默认值
            return [];
        }

        return is_array($saved) ? $saved : [];
    }

    /**
     * 把配置里存的标签解析成一串 slug。
     *
     * 兼容三种历史形态：
     *  - tagSlugs 数组          当前形态，勾选框提交上来的
     *  - tagSlugs 逗号分隔字符串 站上还没有标签时表单退化成文本框，存的是这个
     *  - tagSlug  单个字符串     1.0.0 的单选时代。升级后原样继承，不必让用户重勾
     *
     * 三种都没有（全新安装）时回落到默认标签；只有「显式存了空数组」才算是
     * 「一个都不想选」，不再回落——否则用户取消勾选后标签会自己长回来。
     *
     * @param array<string, mixed> $saved
     * @return array<int, string>
     */
    private static function resolveTagSlugs(array $saved): array
    {
        if (array_key_exists('tagSlugs', $saved)) {
            $value = $saved['tagSlugs'];

            if (is_array($value)) {
                return self::cleanSlugs($value);
            }

            if (is_string($value) && trim($value) !== '') {
                return self::cleanSlugs(explode(',', $value));
            }
        }

        $legacy = $saved['tagSlug'] ?? null;

        if (is_string($legacy) && trim($legacy) !== '') {
            return self::cleanSlugs([$legacy]);
        }

        return self::cleanSlugs((array) self::defaults()['tagSlugs']);
    }

    /**
     * 清洗 slug 列表：丢掉非字符串、空串和重复项，保留原来的顺序。
     *
     * @param array<mixed> $slugs
     * @return array<int, string>
     */
    private static function cleanSlugs(array $slugs): array
    {
        $clean = [];

        foreach ($slugs as $slug) {
            if (!is_string($slug)) {
                continue;
            }

            $slug = trim($slug);

            if ($slug !== '' && !in_array($slug, $clean, true)) {
                $clean[] = $slug;
            }
        }

        return $clean;
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
                _t('正文里一张图都没有时如何处理。')
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
     * 优先做成勾选框而不是自由输入：标签 slug 打错一个字母，前台就是一片空白，
     * 而且没有任何提示——这是这个插件最容易踩的坑，能靠 UI 堵掉就堵掉。
     */
    private static function addTagInput(Form $form): void
    {
        $tags = self::tagOptions();
        $default = (array) self::defaults()['tagSlugs'];
        $saved = self::resolveTagSlugs(self::rawSaved());

        // 站上一个标签都没有（或查库失败）时退回文本框，多个用逗号隔开
        if ($tags === []) {
            $form->addInput(
                (new Text(
                    'tagSlugs',
                    null,
                    implode(',', $saved),
                    _t('相册标签'),
                    _t(
                        '填写标签的缩略名（slug），多个用英文逗号隔开，例如 Photo,JiNan。'
                        . '注意是缩略名不是显示名，站上还没有标签时只能手填。'
                    )
                ))->addRule('required', _t('相册标签不能为空'))
            );

            return;
        }

        // 已保存的标签可能已经被删掉了。Checkbox 里找不到对应选项时它根本不会
        // 渲染出来，用户一保存这项就没了——所以得把它当成一个选项补回去，让用户
        // 看得见、能自己取消。
        foreach ($saved as $slug) {
            if (!isset($tags[$slug])) {
                $tags[$slug] = _t('%s（该标签已不存在，请重新勾选）', $slug);
            }
        }

        // 默认标签同理，得保证它在选项里，否则全新安装时默认值是个看不见的勾
        foreach ($default as $slug) {
            if (!isset($tags[$slug])) {
                $tags[$slug] = $slug;
            }
        }

        $form->addInput(
            (new Checkbox(
                'tagSlugs',
                $tags,
                $saved,
                _t('相册标签'),
                _t(
                    '勾选哪些标签下的文章会被聚合成相册，可多选。'
                    . '同一篇文章同时命中多个标签时，相册里也只会出现一次。'
                )
            ))->multiMode()
        );

        self::addTagStyle($form);
    }

    /**
     * 让标签勾选框一行排多个。
     *
     * multiMode() 会给每个选项挂上 .multiline，而后台样式表里写死了
     * `.multiline{display:block}`——一个标签一行，60 个标签能拉出一屏半，勾起来
     * 得一直往下滚。这里在插件自己的表单上挂个类、补一小段样式把它压回行内，
     * 别的插件和后台其它页面都不受影响（后台没有针对 form 的样式，挂类不会撞车）。
     *
     * white-space:nowrap 是关键：不写的话「生活（Life，24 篇）」会在中文中间断行，
     * 一行看起来像两个残破的选项。
     */
    private static function addTagStyle(Form $form): void
    {
        $form->setAttribute('class', 'aw-tag-form');

        $style = new Layout('style', ['type' => 'text/css']);
        $style->html(
            '.aw-tag-form .multiline{display:inline-block;vertical-align:top;'
            . 'min-width:12em;margin:0 1.4em .45em 0;padding:0;white-space:nowrap}'
        );

        $form->addItem($style);
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
     * 为历史版本里残留、当前表单已不再提供的配置项补一个隐藏字段。
     *
     * Typecho 渲染插件设置页时，会把已保存的每个配置项回填到表单上
     * （Widget\Plugins\Config 里 `$form->getInput($key)->value($val)`），
     * 而 Form::getInput() 没有做空值保护——只要某个已保存的键在当前表单里
     * 找不到对应元素，设置页就会直接 500，且用户无法通过保存来自救。
     *
     * 所以这里把「已保存但表单没有」的键补成隐藏字段，让旧配置可以平滑降级。
     * 1.0.0 单选的 tagSlug 就是靠这里留下来的：它在表单里没了，但配置还在，
     * resolveTagSlugs() 仍读得到，用户一保存才被清成 null。
     */
    private static function addLegacyInputs(Form $form): void
    {
        $saved = self::rawSaved();

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
