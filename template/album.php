<?php
/**
 * 相册墙的主体（网格 + 浮层）。
 *
 * 全部输入都由 Chrome::render() 传进来——主题是两栏还是单栏、有没有导航栏、
 * 标题用哪一个，都在那里判定，所以本文件不需要知道当前跑的是哪个主题。
 */

use TypechoPlugin\AlbumWall\View;

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}

/** @var bool $awThemeChrome 是否套上了主题自己的 header / footer */
$awThemeChrome = $awThemeChrome ?? false;
/** @var bool $awHasSidebar 主题是否有左侧栏 */
$awHasSidebar = $awHasSidebar ?? false;
/** @var string|null $awNavbar 主题导航栏模板的相对路径 */
$awNavbar = $awNavbar ?? null;
/** @var string|null $awHeading 页面标题；为空时用插件设置里的「页面标题」 */
$awHeading = $awHeading ?? null;
/** @var callable|null $need 载入主题模板文件（由 Chrome 提供） */
$need = $need ?? null;

$awAlbums = View::albums();
$awTitle = ($awHeading !== null && $awHeading !== '') ? $awHeading : View::title();
$awPayload = View::payload();
$awCss = View::asset('static/album.css');
$awJs = View::asset('static/album.js');
?>

<?php if ($awThemeChrome && $awHasSidebar): ?>
<?php // 主题是两栏结构：正文收进 #middle，和主题的其它独立页面保持一致 ?>
<div class="col-md-12 col-lg-8" id="middle">
<?php elseif ($awThemeChrome): ?>
<?php // 单栏主题：用插件自己的容器撑开留白，免得正文贴着屏幕边缘 ?>
<div class="aw-container">
<?php endif; ?>
    <?php
    /*
     * 样式表必须放在 #middle **里面**。
     *
     * Jasmine 的 pjax 只把新页面的 #middle 内容搬过来，放在 #middle 外面的
     * 东西在 pjax 导航时会被整段丢掉——之前这里就踩过：链接写在 #middle 之前，
     * 走 pjax 进相册页时样式表根本没到。
     *
     * 放在这里还有个附带好处：<link> 是阻塞渲染的，摆在 #middle 最前面，
     * 下面的导航栏和相册会等它加载完再画，不会有一下没样式的闪烁。
     */
    ?>
    <link rel="stylesheet" href="<?php echo View::escape($awCss); ?>" data-aw-css>
    <?php if ($awNavbar !== null && is_callable($need)): ?>
        <?php $need($awNavbar); ?>
    <?php endif; ?>
    <?php // aw-stack / aw-stack-tight 见 static/album.css：主题只带了一部分 Bootstrap
          // 工具类时（例如只有 .d-flex 没有 .flex-column），靠它们兜住纵向排布 ?>
    <div class="container-fluid p-4 d-flex flex-column row-gap-3 aw-stack">
        <div class="card border-0 py-3 col-12">
            <div class="d-flex column-gap-2">
                <div class="card-body p-0 d-flex flex-column justify-content-between row-gap-1 overflow-hidden aw-stack-tight">
                    <?php if ($awThemeChrome): ?>
                        <?php // 套了主题外壳：标题用主题的 <h3>，样式与其它页面一致 ?>
                        <h3><?php echo View::escape($awTitle); ?></h3>
                        <?php if ($awAlbums !== []): ?>
                            <p class="aw-subtitle text-body-tertiary">
                                <?php echo View::escape(_t('%d 个相册 · %d 张照片', View::count(), View::photoCount())); ?>
                            </p>
                        <?php endif; ?>
                    <?php endif; ?>

                    <div class="aw-app" data-aw-theme="<?php echo View::escape(View::flavor()); ?>">
                        <?php if ($awAlbums === []): ?>
                            <p class="aw-empty">
                                <?php echo View::escape(_t('这个标签下还没有带图片的文章。')); ?>
                            </p>
                        <?php else: ?>
                            <div class="aw-grid">
                                <?php foreach ($awAlbums as $album): ?>
                                    <?php
                                    $awCover = (string) ($album['cover'] ?? '');
                                    $awLabel = _t('打开相册：%s，%d 张照片', (string) $album['title'], (int) $album['count']);
                                    ?>
                                    <?php
                                    // 标题和日期在封面**上方**，和详情面板里是同一个顺序。
                                    // 这样展开时封面只是原地长大并下移，不用越过标题去，
                                    // 两个元素各走各的，观感顺很多。
                                    ?>
                                    <button type="button"
                                            class="aw-card"
                                            data-cid="<?php echo (int) $album['cid']; ?>"
                                            aria-label="<?php echo View::escape($awLabel); ?>"
                                            aria-expanded="false">
                                        <span class="aw-card__meta">
                                            <span class="aw-card__title"><?php echo View::escape((string) $album['title']); ?></span>
                                            <?php
                                            // 日期和张数同在一行，形态和详情面板里那一行一致
                                            // （详情只是在这条后面再接一个「阅读原文」）。
                                            // 张数写在这里而不是压在封面角上：一来相册的"份量"
                                            // 本来就属于这条说明，二来它贴着日期，展开时整条
                                            // 可以原样飞过去，不必再单独造一个角标替身。
                                            ?>
                                            <span class="aw-card__sub">
                                                <span class="aw-card__date"><?php echo View::escape((string) $album['date']); ?></span>
                                                <?php // 0 张时连分隔号一起省掉，否则会剩下一个孤零零的「·」
                                                      // （JS 那边照抄这条的 DOM，两边自然一致） ?>
                                                <?php if ((int) $album['count'] > 0): ?>
                                                    <span class="aw-card__sep" aria-hidden="true">·</span>
                                                    <span class="aw-card__count"><?php echo View::escape(_t('%d 张', (int) $album['count'])); ?></span>
                                                <?php endif; ?>
                                            </span>
                                        </span>
                                        <span class="aw-card__cover">
                                            <?php if ($awCover !== ''): ?>
                                                <img src="<?php echo View::escape($awCover); ?>"
                                                     alt=""
                                                     loading="lazy"
                                                     decoding="async">
                                            <?php else: ?>
                                                <span class="aw-card__blank" aria-hidden="true"></span>
                                            <?php endif; ?>
                                            <?php // 封条收进封面里：外壳要飞的正是封面这一块，
                                                  // 它跟着封面一起被无缝接管 ?>
                                            <span class="aw-card__veil" aria-hidden="true"></span>
                                        </span>
                                    </button>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>

                        <?php // 详情面板的内容由 JS 按需填充，首屏只带一份数据 ?><?php ?>
                        <script type="application/json" class="aw-data"><?php
                            // JSON_HEX_TAG 会把 < > 转成 < >，
                            // 标题里就算写了 </script> 也钻不出这个标签
                            echo json_encode(
                                $awPayload,
                                JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP
                                | JSON_HEX_APOS | JSON_HEX_QUOT
                            );
                        ?></script>

                        <?php // ── 浮层 ──────────────────────────────────────────────
                              // 这三个是 position:fixed 的，需要时由 JS 挪到 <body> 下，
                              // 免得被带 transform 的祖先改了包含块。 ?>
                        <div class="aw-scrim" hidden></div>

                        <?php // 外壳要长得和卡片封面一模一样（含封条），
                              // 起点才能严丝合缝地接管它 ?>
                        <div class="aw-shell" hidden aria-hidden="true">
                            <span class="aw-shell__veil"></span>
                        </div>

                        <?php
                        /*
                         * 文字替身。两个都是独立的一份，而不是塞进 .aw-shell：
                         * 外壳要随宽度变形（那是在改盒子尺寸），文字却得按字号
                         * 等比放大（那是在做 transform），两件事的算法不一样，
                         * 挤在一个元素里就没法各按各的来。
                         *
                         * 它们各自落在详情的标题行和「日期 · 张数」那行上，
                         * 所以每个的落点、放大倍数都单独算，互不牵连。
                         *
                         * 类名是"卡片那一组 + aw-shell__*"两个一起挂：排版规则
                         * 和卡片里那份共用同一套，落位时才对得上。
                         */
                        ?>
                        <span class="aw-card__title aw-shell__title" hidden aria-hidden="true"></span>
                        <span class="aw-card__sub aw-shell__sub" hidden aria-hidden="true"></span>

                        <div class="aw-detail"
                             hidden
                             role="dialog"
                             aria-modal="true"
                             aria-labelledby="aw-detail-title">
                            <div class="aw-detail__scroll">
                                <div class="aw-detail__inner">
                                    <header class="aw-detail__head">
                                        <h2 class="aw-detail__title" id="aw-detail-title"></h2>
                                        <?php // 日期与张数由 JS 从卡片 DOM 上照抄，两边字符串必须一模一样，
                                              // 替身落位才谈得上严丝合缝；「阅读原文」是详情独有的，
                                              // 它在落位时才跟着这一行一起淡入 ?>
                                        <p class="aw-detail__meta">
                                            <time class="aw-detail__date"></time>
                                            <span class="aw-detail__sep" aria-hidden="true">·</span>
                                            <span class="aw-detail__count"></span>
                                            <a class="aw-detail__link"
                                               target="_blank"
                                               rel="noopener"><?php echo View::escape(_t('阅读原文')); ?></a>
                                        </p>
                                    </header>

                                    <figure class="aw-detail__cover"><img alt="" decoding="async"></figure>

                                    <div class="aw-photos"></div>
                                    <p class="aw-detail__empty" hidden>
                                        <?php echo View::escape(_t('封面之外没有别的照片了。')); ?>
                                    </p>
                                </div>
                            </div>

                            <?php // 关闭按钮待在滚动区**外面**、但和面板右边缘对齐（几何见 CSS 里的
                                  // --aw-panel-w / --aw-pad）。放进面板里它会随相册一起滚走，
                                  // 钉在视口角落又离内容太远 ?>
                            <button type="button" class="aw-detail__close" aria-label="<?php echo View::escape(_t('关闭相册')); ?>">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>

                        <?php // ── 浮层：单张照片 ────────────────────────────────────
                              // 和上面那几个一样是 position: fixed 的，由 JS 挪到 <body> 下。
                              // 它是更上面的一层（z-index 更高），关相册时一并收走。
                              //
                              // 白框和舞台的宽高由 JS 写成行内样式：框要"裱住这一张"，
                              // 四边白边得一样宽，边长就必须跟着照片的比例走——而这个
                              // 比例只有图下载完才知道，CSS 这层拿不到。见 album.js 的 fitRect()。 ?>
                        <div class="aw-viewer"
                             hidden
                             role="dialog"
                             aria-modal="true"
                             aria-label="<?php echo View::escape(_t('照片')); ?>"
                             data-aw-label="<?php echo View::escape(_t('查看大图：第 %1$d 张，共 %2$d 张')); ?>">
                            <div class="aw-viewer__backdrop"></div>

                            <?php // 装裱的白框。tabindex="-1" 是为了落位后能把焦点收过来，
                                  // 键盘用户不至于还停在身后那面墙上 ?>
                            <div class="aw-viewer__frame" tabindex="-1">
                                <?php // 框内。照片在这里被裁切边，放缩和平移只作用在这一层里面，
                                      // 框本身一动不动——"在框内放缩"就是这一条 ?>
                                <div class="aw-viewer__stage">
                                    <img class="aw-viewer__img" alt="" decoding="async" draggable="false">
                                </div>
                            </div>

                            <?php // 飞行外壳。盒子就是终点那块舞台，起点靠 scale 缩回缩略图——
                                  // 这样飞行途中是按大图渲染再缩小的，比反过来放大要清楚，
                                  // 和文字替身（.aw-shell__title）是同一个道理 ?>
                            <div class="aw-viewer__fly" hidden aria-hidden="true">
                                <img alt="" decoding="async" draggable="false">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <?php
    /*
     * 脚本加载器。同样必须待在 #middle 里面——理由和上面的样式表一样：
     * pjax 只搬运 #middle 的内容，放在外面的 <script> 换页时根本到不了。
     *
     * 为什么是"加载器"而不是直接 <script src>：
     *
     *  - Jasmine 的 pjax 会**跳过带 src 的脚本**（pjax.js 里 `if (oldScript.src)
     *    continue;`），外链脚本在 pjax 导航时不重新执行；内联脚本才是它特意
     *    重新执行的那一类，所以入口只能写成内联。
     *  - 但 pjax 也不会同步 <head> 里的样式表，所以 CSS 得在这里补一次。
     *  - album.js 本身只加载一次就够，它会把 window.AlbumWall 留在全局，
     *    并自己监听 pjax:complete 重新初始化。
     */
    ?>
    <script>
    (function () {
        var CSS = <?php echo json_encode($awCss); ?>;
        var JS = <?php echo json_encode($awJs); ?>;

        // 首屏时模板里那份 <link> 已经在 #middle 里了；走 pjax 进来时它可能
        // 被 HTML 片段解析器丢掉，所以这里统一保证 <head> 里有一份。
        if (!document.head.querySelector('link[data-aw-css]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = CSS;
            link.setAttribute('data-aw-css', '');
            document.head.appendChild(link);
        }

        function boot() {
            if (window.AlbumWall) {
                window.AlbumWall.init();
            }
        }

        // 已经加载过（同一个会话里第二次进相册页）就直接初始化
        if (window.AlbumWall) {
            boot();
            return;
        }

        // 同一次导航里可能有多个实例在等同一个脚本，共用一个 load 回调即可
        var pending = document.querySelector('script[data-aw-bundle]');
        if (pending) {
            pending.addEventListener('load', boot);
            return;
        }

        var script = document.createElement('script');
        script.src = JS;
        script.setAttribute('data-aw-bundle', '');
        script.addEventListener('load', boot);
        document.head.appendChild(script);
    })();
    </script>
<?php if ($awThemeChrome): ?>
</div>
<?php endif; ?>
