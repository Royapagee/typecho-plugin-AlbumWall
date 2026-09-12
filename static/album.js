/*
 * AlbumWall —— 相册墙的展开动画
 *
 * 有两层浮层，各有一套开合动画，用的是同一个套路（FLIP）：
 *
 *   相册详情  卡片封面 → 面板里那张大图
 *   单张照片  墙上的缩略图 → 白框里的照片
 *
 * 整体是 FLIP 的思路，但"飞行"这件事拆成了两类元素、两套手法：
 *
 *   封面用 .aw-shell —— 它逐帧改 top/left/width/height，而不是 transform。
 *     原因是封面要从卡片的 3:2 变成详情里更扁的一块，用 scale(sx, sy) 这种
 *     非等比缩放会把图片一起拉变形；改盒子尺寸则交给 background-size: cover
 *     重新裁切，图片全程不变形。代价是每帧要布局，但这是个 position: fixed
 *     的孤立元素，布局范围就它自己，不会波及身后的网格。
 *
 *   文字用 .aw-shell__title / .aw-shell__sub —— 反过来，它们走 transform 等比
 *     缩放。文字只该等比放大（非等比会糊成一片），而且 transform 不触发布局，
 *     最便宜。各自独立，不挂在 .aw-shell 底下：外壳在改盒子尺寸，文字不能跟着变。
 *
 *     网格卡片上那两行文字（标题、日期·张数）各自对应详情里的一行，所以是
 *     两个替身、两套落点；哪一段没有对应物，就不该混进替身里——详见 ghost()。
 *
 * 网格本身在动画期间保持原样，被点的那张卡片只是 visibility: hidden 让位——
 * 网格一旦塌陷，"从网格里裂开"的观感就没了。
 *
 * 照片那一层的飞行是另一种算法，写在文件下半部分的「单张照片详情」里：
 * 那边两端是**同一个比例**（缩略图不裁切，框也是照着照片比例量的），所以
 * 一个等比 scale 就够，不必像封面那样逐帧改盒子尺寸。
 *
 * pjax 相关：Jasmine 的 pjax 只替换 #middle，而且跳过带 src 的脚本，所以本文件
 * 由模板里的内联加载器负责引入，这里只把 init() 挂在 window.AlbumWall 上并
 * 自己监听 pjax:complete。
 */

(function () {
    'use strict';

    /** 当前的相册实例。一个页面上只可能有一个 .aw-app，所以状态就存这儿了 */
    var S = {
        app: null,
        data: null,
        grid: null,
        cards: [],
        scrim: null,
        shell: null,
        shellVeil: null,
        titleGhost: null,
        subGhost: null,
        detail: null,
        detailScroll: null,
        detailTitle: null,
        detailMeta: null,
        detailDate: null,
        detailSep: null,
        detailCount: null,
        detailLink: null,
        hero: null,
        heroImg: null,
        photos: null,
        empty: null,
        closeBtn: null,

        /** 照片墙里那些 <button class="aw-photo">，摆进哪一列由 layoutWall() 决定 */
        wallItems: [],
        /** 当前摆了几列，0 = 还没摆过 */
        wallCols: 0,

        openCard: null,
        pendingOpen: null,
        /**
         * 相册落位之后要接着展开的照片下标。
         *
         * 相册本身的展开要 620ms，而 #album-47-p3 这种地址进来时照片层得等它
         * 落位——缩略图得先有个稳定的位置，飞行才有起点。所以先记在这儿，
         * settle() 到点时再取走。
         */
        pendingPhoto: null,
        busy: false,
        timer: null,
        /** 落位后替身淡出的收尾定时器，和 timer 分开：它不该挡住任何操作 */
        fadeTimer: null,

        lockedOverflow: '',
        lockedPadding: ''
    };

    var DEFAULTS = { dur: 620, cross: 220, ease: 'cubic-bezier(.22,.9,.28,1)' };

    /* 照片墙的列参数。对应原来 CSS 里那条 columns: 4 170px（最多 4 列、每列
       不窄于 170px），列数现在由 JS 自己算——理由见 album.css 里 .aw-photos
       那一段注释：多列布局会在除不尽的时候留下一整列空位。 */
    var WALL_MAX_COLS = 4;
    var WALL_MIN_COL_W = 170;

    // ────────────────────────────────────────────────────────
    // 入口
    // ────────────────────────────────────────────────────────

    /**
     * 初始化。会被调用多次，必须幂等：
     *  - 相册模板里的内联加载器调一次
     *  - album.js 自己的 pjax:complete 监听再调一次
     *
     * 注意清理残骸的时机。浮层一旦被搬进 <body>，它们和"上一页遗留的浮层"
     * 在 DOM 上就长得一模一样了。所以 dropOrphans() 只能在没有待初始化的
     * .aw-app 时才跑——那种时刻 body 下的浮层必定是上一个页面的遗物。
     * 已经初始化过就别再清，否则会把正在用的浮层删掉，而 setup() 因为
     * data-aw-ready 已经打上也不会重建，页面就此失去弹层能力。
     */
    function init() {
        var apps = document.querySelectorAll('.aw-app');
        var pending = [];

        for (var i = 0; i < apps.length; i++) {
            if (!apps[i].hasAttribute('data-aw-ready')) {
                pending.push(apps[i]);
            }
        }

        // 这页没有相册墙（多半是刚从相册页 pjax 走掉），把残骸和滚动锁收干净
        if (apps.length === 0) {
            dropOrphans();
            return;
        }

        // 已经初始化过了，什么都别动
        if (pending.length === 0) {
            return;
        }

        dropOrphans();

        for (var j = 0; j < pending.length; j++) {
            setup(pending[j]);
        }
    }

    function dropOrphans() {
        var orphans = document.querySelectorAll(
            'body > .aw-scrim, body > .aw-shell, body > .aw-shell__title, body > .aw-shell__sub, '
            + 'body > .aw-detail, body > .aw-viewer'
        );

        for (var i = 0; i < orphans.length; i++) {
            orphans[i].remove();
        }

        // 上一页如果是在相册（或者照片）打开状态下被换掉的，滚动锁还挂着，
        // 状态也还停在半路，这里一并还原
        unlockScroll();
        S.openCard = null;
        S.busy = false;
        S.pendingOpen = null;
        S.pendingPhoto = null;
        hidePhotoNow();
        stopTimers();

        document.documentElement.removeAttribute('data-aw-theme');
    }

    /**
     * 把两个定时器都停掉。
     *
     * 必须成对清理：进场/退场那个 timer 到点会改一堆状态（收起浮层、解锁滚动、
     * 清 is-flying），要是在它到点之前又走了一次 close()，旧的回调照样会烧起来，
     * 而那时候页面早就是另一副样子了——它会把正在飞的外壳和替身一并藏掉。
     */
    function stopTimers() {
        if (S.timer) {
            window.clearTimeout(S.timer);
            S.timer = null;
        }

        if (S.fadeTimer) {
            window.clearTimeout(S.fadeTimer);
            S.fadeTimer = null;
        }
    }

    function setup(app) {
        // 浮层会被挪到 <body> 下，那时它们就不再是 .aw-app 的后代了。把配色档位
        // 在 <html> 上再打一份，CSS 变量才继续吃得到。
        document.documentElement.setAttribute(
            'data-aw-theme',
            app.getAttribute('data-aw-theme') || 'default'
        );

        S.app = app;
        S.data = readData(app);

        S.grid = app.querySelector('.aw-grid');
        S.cards = toArray(app.querySelectorAll('.aw-card'));

        S.scrim = app.querySelector('.aw-scrim');
        S.shell = app.querySelector('.aw-shell');
        S.shellVeil = app.querySelector('.aw-shell__veil');
        S.titleGhost = app.querySelector('.aw-shell__title');
        S.subGhost = app.querySelector('.aw-shell__sub');

        S.detail = app.querySelector('.aw-detail');
        S.detailScroll = app.querySelector('.aw-detail__scroll');
        S.detailTitle = app.querySelector('.aw-detail__title');
        S.detailMeta = app.querySelector('.aw-detail__meta');
        S.detailDate = app.querySelector('.aw-detail__date');
        S.detailSep = app.querySelector('.aw-detail__sep');
        S.detailCount = app.querySelector('.aw-detail__count');
        S.detailLink = app.querySelector('.aw-detail__link');

        S.hero = app.querySelector('.aw-detail__cover');
        S.heroImg = app.querySelector('.aw-detail__cover img');
        S.photos = app.querySelector('.aw-photos');
        S.empty = app.querySelector('.aw-detail__empty');
        S.closeBtn = app.querySelector('.aw-detail__close');

        setupViewer(app);

        // 标记放在检查之后：模板缺件时不要打上 ready，否则 init() 会当它
        // 已经装好，再也不会重试
        if (!S.grid || !S.detail || !S.shell || !S.titleGhost || !S.subGhost) {
            return;
        }

        app.setAttribute('data-aw-ready', '1');

        // position: fixed 的包含块必须是视口。只要祖先里有一个带 transform /
        // filter / perspective 的元素，fixed 就会改成相对它定位，动画会整个跑偏。
        // 与其逐个探测祖先，不如直接挪到 body 下，一了百了。
        ensureInBody(S.scrim);
        ensureInBody(S.shell);
        ensureInBody(S.titleGhost);
        ensureInBody(S.subGhost);
        ensureInBody(S.detail);
        ensureInBody(V.el);

        bind(app);

        // 带 #album-数字 直接打开页面时，直接把那个相册展开；
        // 带 #album-数字-p数字 的连那一张照片一起展开（等相册落位后再展开，
        // 那会儿缩略图才有稳定的起点）
        var state = hashState();
        if (state) {
            var card = cardFor(state.cid);
            if (card) {
                S.pendingPhoto = state.photo === null ? null : state.photo - 1;
                open(card, true);
            }
        }
    }

    /**
     * 照片那一层要用的元素。setupViewer 在 setup() 的**检查之前**调用：
     * 它只负责认领元素和挂事件，模板里没有这一层时后面那条检查照样能拦住。
     */
    function setupViewer(app) {
        V.el = app.querySelector('.aw-viewer');

        if (!V.el) {
            return;
        }

        V.backdrop = V.el.querySelector('.aw-viewer__backdrop');
        V.frame = V.el.querySelector('.aw-viewer__frame');
        V.stage = V.el.querySelector('.aw-viewer__stage');
        V.img = V.el.querySelector('.aw-viewer__img');
        V.fly = V.el.querySelector('.aw-viewer__fly');
        V.flyImg = V.fly ? V.fly.querySelector('img') : null;

        if (!V.frame || !V.stage || !V.img || !V.fly || !V.flyImg) {
            V.el = null;
            return;
        }

        bindViewer();
    }

    function ensureInBody(el) {
        if (el && el.parentNode !== document.body) {
            document.body.appendChild(el);
        }
    }

    function bind(app) {
        S.cards.forEach(function (card) {
            card.addEventListener('click', function () {
                if (albumFromHash() === card.getAttribute('data-cid')) {
                    // hash 已经是它了，pushState 不会产生新记录，Back 键就关不掉。
                    // 理论上走不到（能点就说明面板没开），保险起见直接开
                    open(card, true);
                    return;
                }
                open(card);
            });

            // 悬停/聚焦时先把封面和大图前几张悄悄下下来。相册封面就是正文第一张，
            // 等点下去再开始下，飞行动画那 620ms 里很可能还没到，外壳会是空的。
            card.addEventListener('pointerenter', function () { warm(card); });
            card.addEventListener('focus', function () { warm(card); });
        });

        if (S.closeBtn) {
            S.closeBtn.addEventListener('click', function () { requestClose(); });
        }

        if (S.scrim) {
            S.scrim.addEventListener('click', function () { requestClose(); });
        }
    }

    // ────────────────────────────────────────────────────────
    // 打开
    // ────────────────────────────────────────────────────────

    function open(card, fromHistory) {
        if (S.busy || S.openCard) {
            return;
        }

        var cid = card.getAttribute('data-cid');
        var album = S.data[cid];

        if (!album) {
            return;
        }

        S.busy = true;
        S.openCard = card;

        if (!fromHistory) {
            pushHash(cid);
        }

        // 锁页面滚动必须赶在一切测量之前。锁了之后页面的滚动条消失，视口宽出
        // 一个滚动条的宽度：网格会右移半个滚动条，position: fixed 的详情整体
        // 变宽、居中面板也右移一半。先锁再量，起点终点才都在同一套坐标里。
        lockScroll();

        // ── 起点：卡片上各元素此刻的位置 ──
        var coverEl = card.querySelector('.aw-card__cover');
        var coverRect = rect(coverEl);
        var cardRect = rect(card);

        fill(album, card);

        // ── 终点：把详情摆好再量 ──
        // 用 visibility 藏而不是 display: none —— 后者根本不布局，量出来全是 0
        S.detail.hidden = false;
        S.detail.style.visibility = 'hidden';

        // 必须带上 is-open 再量。.aw-detail__inner 的入场动画起点是
        // translateY(10px)，不带 is-open 量到的终点会整体偏下 10px，
        // 封面就会飞到比真身低一截的位置，落位那一刻看得见跳一下。
        S.detail.classList.remove('is-closing', 'is-settled');
        S.detail.classList.add('is-open');

        // 强制一次布局，让下面几个 rect 拿到的是详情真实落位后的值
        void S.detail.offsetWidth;

        // 详情摆出来了，照片墙的分列这时候才算得准（fill() 那次还是 display:none）。
        // 位置在首图下面，重排不会动到 heroRect，所以放在量尺寸之前更省事
        layoutWall();

        var heroRect = album.cover ? rect(S.hero) : null;
        var panelRadius = radiusOf(S.detail.querySelector('.aw-detail__inner'));

        // 替身的终点也得在这一刻量。拿下 is-open 之后 .aw-detail__inner 会退回
        // translateY(10px)，再量就整体偏下 10px，替身会落到比真身低一截的地方
        var ghosts = [
            ghost(S.titleGhost, card.querySelector('.aw-card__title'), S.detailTitle, false),
            ghost(S.subGhost, card.querySelector('.aw-card__sub'), S.detailMeta, false)
        ];

        // 量完立刻退回入场前的状态，下面 rAF 里再重新加回来，
        // 面板"浮上来"的那段动画才跑得起来
        S.detail.classList.remove('is-open');
        void S.detail.offsetWidth;

        // 面板的宽度确定了，这时候量滚动条槽才准（详情是 display:none 时量不到）
        syncGutter();

        // ── 铺起点 ──
        if (heroRect && coverRect.width > 0) {
            S.shell.hidden = false;
            S.shell.style.backgroundImage = album.cover
                ? 'url("' + cssUrl(album.cover) + '")'
                : 'none';
            S.shell.style.borderRadius = radiusOf(coverEl);
            S.shell.style.transition = 'none';
            S.shell.classList.remove('is-fading');
            S.shell.style.opacity = '';
            S.shell.style.top = '';
            S.shell.style.left = '';
            place(S.shell, coverRect);
            S.shellVeil.style.opacity = '1';
        } else {
            // 没有封面就没什么好飞的，详情直接淡入
            S.shell.hidden = true;
        }

        ghosts.forEach(layGhost);

        // 被点的卡片原地留白（不是移除），网格照旧撑着
        card.classList.add('is-flying');
        pushNeighbours(cardRect);

        S.scrim.hidden = false;
        S.detail.style.visibility = '';

        // ── 下一帧改终点，过渡才会跑 ──
        window.requestAnimationFrame(function () {
            var dur = readDur();
            var ease = readEase();

            if (heroRect) {
                S.shell.style.transition = [
                    'top ' + dur + 'ms ' + ease,
                    'left ' + dur + 'ms ' + ease,
                    'width ' + dur + 'ms ' + ease,
                    'height ' + dur + 'ms ' + ease,
                    'border-radius ' + dur + 'ms ' + ease
                ].join(', ');

                place(S.shell, heroRect);
                S.shell.style.borderRadius = panelRadius;

                // 封条淡出，观感上就是相册被拆封
                S.shellVeil.style.opacity = '0';
            }

            ghosts.forEach(function (g) { flyGhost(g, dur, ease); });

            S.scrim.classList.add('is-on');
            S.detail.classList.add('is-open');

            S.timer = window.setTimeout(settle, dur + 30);
        });
    }

    // ────────────────────────────────────────────────────────
    // 文字替身
    // ────────────────────────────────────────────────────────

    /**
     * 造一份"这段文字从哪飞到哪"的交代。
     *
     * 替身自己的字号永远是卡片那一档（模板上给它挂了 .aw-card__title /
     * .aw-card__sub，和卡片里那份共用同一套排版规则），所以"看起来像详情那一行"
     * 靠的是 scale 放大——倍数取两端**字号**之比，不是宽度之比：按宽度比会把
     * 单行标题拉成详情那么宽，字就变形了。
     *
     * 落位要严丝合缝，就得让替身**终点**的视觉矩形等于终点真身的矩形。替身的
     * 视觉矩形 = 盒子 × scale，于是两端各按自己的倍数把盒子折回去：
     *
     *   起点：盒子摆到起点的左上角，尺寸 = 起点矩形 / 起点倍数
     *   终点：整体平移到终点的左上角，放大到终点倍数，尺寸 = 终点矩形 / 终点倍数
     *
     * 倍数就是两端的字号之比 k：替身是按卡片那一档字号写的，长成详情那么大要乘
     * k；反过来飞回卡片时就乘 1，因为替身和卡片本来就同字号。
     *
     * 这个 k 能一直这么干净，前提是**卡片那一头没有被任何祖先 transform 缩过**。
     * 网格和卡片一旦带上缩放，卡片上的字就不是"字号原样"渲染的了，替身得额外
     * 补偿那层缩放（少乘一下，收回落地那一刻标题会当场胖 8%）。所以网格的"后退"
     * 只用模糊和压暗——它俩不动几何。
     *
     * ── 曾经踩过的两个坑（都是"看着差不多、其实是错的"）──
     *
     * 一是起点直接拿上一个方向残留的 transform 去凑。收回时 place() 已经把盒子
     * 挪到了详情那一头，残留的 translate 是"卡片→详情"的位移，叠上去就是
     * 详情 + (详情 - 卡片)——替身从终点又往前多飞了一个身位。
     *
     * 二是收回时忘了把倍数收回卡片那一档，一路缩回去、尺寸却还是详情那么大，
     * 落位那一刻由大变小地"啪"一下。
     *
     * @param {Element} el       替身元素
     * @param {Element} smallEl  卡片上那一段文字（字号小的那一头）
     * @param {Element} toEl     详情里对应的那一段（字号大的那一头）
     * @param {boolean} back     true = 从详情飞回卡片
     */
    function ghost(el, smallEl, toEl, back) {
        // 卡片上缺这一段（比如 0 张的相册没有「N 张」）就别飞了，
        // 硬飞只会让详情那一行凭空多出一截
        if (!smallEl || !toEl) {
            return { el: el, skip: true };
        }

        /*
         * 起点和终点都是**当场量**的。收回时量到的就是卡片此刻所在——整段回程里
         * 它一动不动（网格不再缩放，它自己的外推位移也是 0），所以开工时量的那一次
         * 到落位时依然有效。
         */
        var from = rect(back ? toEl : smallEl);
        var to = rect(back ? smallEl : toEl);
        var k = fontSize(toEl) / fontSize(smallEl) || 1;
        var sFrom = back ? k : 1;
        var sTo = back ? 1 : k;

        // 内容整条照抄卡片那一份。这里用 innerHTML 是因为副标题那条里有三个
        // span（日期 / 分隔 / 张数），少一个子元素就少一个 flex 间距，替身和
        // 详情那一行就对不齐了。来源是本插件自己渲染、服务端已经转义过的标记。
        el.innerHTML = smallEl.innerHTML;

        return {
            el: el,
            skip: false,
            box: {
                top: from.top,
                left: from.left,
                width: from.width / sFrom,
                height: from.height / sFrom
            },
            dx: to.left - from.left,
            dy: to.top - from.top,
            sFrom: sFrom,
            sTo: sTo,
            // 终点宽度。展开时长标题要一路把省略号"放开"，收回时再收回去，
            // 两端才都对得上真身的宽度
            width: to.width / sTo
        };
    }

    /** 铺起点：把替身摆到 from 那一端，清掉上一轮留下的过渡和淡出状态 */
    function layGhost(g) {
        if (g.skip) {
            g.el.hidden = true;
            return;
        }

        g.el.hidden = false;
        g.el.classList.remove('is-fading');
        g.el.style.opacity = '';
        g.el.style.transition = 'none';
        g.el.style.transform = 'translate(0,0) scale(' + g.sFrom + ')';
        place(g.el, g.box);
    }

    /** 下一帧改终点，过渡才会跑 */
    function flyGhost(g, dur, ease) {
        if (g.skip) {
            return;
        }

        g.el.style.transition = [
            'transform ' + dur + 'ms ' + ease,
            'width ' + dur + 'ms ' + ease
        ].join(', ');

        g.el.style.transform =
            'translate(' + g.dx + 'px,' + g.dy + 'px) scale(' + g.sTo + ')';
        g.el.style.width = g.width + 'px';
    }

    /**
     * 落位：替身淡出、真身淡入。
     *
     * 两边同时走、位置像素重合，所以这一换本身是看不见的。之所以还要留这段
     * 交叉淡化，是为了化掉替身身上那点缩放糊——transform 放大过的文字是按
     * 原字号栅格化再拉大的，落位那一刻会"啪"地变清晰，那是整段动画里最像
     * "跳了一下"的地方。
     *
     * 封面外壳也一起淡。它和详情那张 <img> 是同一张图、同一个矩形，叠着自己
     * 淡入淡出本来就看不出来；真正解决的是另一件事：外壳原先是被"啪"地藏掉的，
     * 而真身要 160ms 才淡上来，中间那一小段封面是空的，图片越大越明显。
     */
    function crossFade() {
        var cross = readMs('--aw-cross', DEFAULTS.cross);

        [S.titleGhost, S.subGhost, S.shell].forEach(function (el) {
            if (!el || el.hidden) {
                return;
            }

            // 先交回给样式表：飞行期间写在行内 style 上的那些过渡会盖掉
            // class 里的这一条
            el.style.transition = '';
            el.classList.add('is-fading');
        });

        S.fadeTimer = window.setTimeout(function () {
            S.fadeTimer = null;
            hideGhosts();
        }, cross + 20);
    }

    /** 淡出走完（或者被打断）之后，把替身收干净 */
    function hideGhosts() {
        [S.titleGhost, S.subGhost, S.shell].forEach(function (el) {
            if (el) {
                el.hidden = true;
            }
        });
    }

    /**
     * 落位：把标题、日期和封面从替身交回给详情里的真身。
     *
     * 交接是无声的——外壳的终点矩形就是封面真身的矩形，替身缩放后的落点就是
     * 目标那一段真身的矩形，三处像素级重合，所以直接换掉即可；真正要处理的
     * 只剩"替身被放大过、栅格化是糊的"这一件事，交给 crossFade() 淡掉。
     */
    function settle() {
        S.timer = null;

        S.detail.classList.add('is-settled');
        crossFade();

        // 替身还在淡出（还有两百来毫秒），但操作不欠着了：
        // 关闭按钮、Esc、点遮罩都该立刻能用
        S.busy = false;

        if (S.closeBtn) {
            try {
                S.closeBtn.focus({ preventScroll: true });
            } catch (e) {
                S.closeBtn.focus();
            }
        }

        // 相册落位了，缩略图这才有稳定的位置。地址里带着照片序号的（#album-47-p3）
        // 在这里把它展开，飞行就有起点可量
        if (S.pendingPhoto !== null) {
            var index = S.pendingPhoto;
            S.pendingPhoto = null;
            openPhotoByIndex(index, true);
        }
    }

    // ────────────────────────────────────────────────────────
    // 关闭
    // ────────────────────────────────────────────────────────

    /**
     * 关闭请求。默认走 history.back()，让"点关闭"和"按后退键"是同一条代码路径，
     * hash 也顺带被清掉。pushState 失败（或 hash 不是我们写的）时直接关。
     */
    function requestClose() {
        if (!S.openCard || S.busy) {
            return;
        }

        // 照片开着的时候，"关"的应该是照片那一层。正常情况下走不到这里
        // （关闭按钮和遮罩都被照片那层盖住了），但 Esc 和它共用一条路，
        // 以后谁再多挂一个入口就容易踩上
        if (V.open) {
            requestClosePhoto();
            return;
        }

        if (albumFromHash()) {
            S.busy = true;
            try {
                history.back();
                return;
            } catch (e) {
                S.busy = false;
            }
        }

        close();
    }

    function close() {
        if (!S.openCard) {
            return;
        }

        var card = S.openCard;
        var coverEl = card.querySelector('.aw-card__cover');

        S.busy = true;

        // 照片那层直接收掉，不给它飞回去的余地：相册自己都要飞回网格了，
        // 缩略图的落点下一帧就不在那儿了。正常路径下走不到（照片开着时
        // 相册的关闭按钮在它底下点不着），只有连着按两次后退会撞上
        if (V.open) {
            hidePhotoNow();
        }

        // 进场那趟如果还没到点（比如开着动画时按了后退），先把它掐掉：
        // 它的回调到点会去藏外壳和替身，而那会儿这些元素正在往回飞
        stopTimers();

        // 详情里可能已经滚到下面了，先归位——否则封面是从屏幕外飞回去的
        if (S.detailScroll) {
            S.detailScroll.scrollTop = 0;
        }

        var coverRect = rect(coverEl);
        var heroRect = S.hero.hidden ? null : rect(S.hero);

        // 替身的起点在详情那一头，也要带上 is-open 量（同 open 里那条注释）
        var ghosts = [
            ghost(S.titleGhost, card.querySelector('.aw-card__title'), S.detailTitle, true),
            ghost(S.subGhost, card.querySelector('.aw-card__sub'), S.detailMeta, true)
        ];

        S.detail.classList.remove('is-open', 'is-settled');
        S.detail.classList.add('is-closing');

        var dur = readDur();
        var ease = readEase();

        if (heroRect && coverRect.width > 0) {
            S.shell.hidden = false;
            S.shell.classList.remove('is-fading');
            S.shell.style.opacity = '';
            S.shell.style.transition = [
                'top ' + dur + 'ms ' + ease,
                'left ' + dur + 'ms ' + ease,
                'width ' + dur + 'ms ' + ease,
                'height ' + dur + 'ms ' + ease,
                'border-radius ' + dur + 'ms ' + ease
            ].join(', ');

            place(S.shell, heroRect);
            S.shell.style.borderRadius = panelRadiusOf();

            // 下一帧再往回飞，否则上面这次赋值会和起点合并成一次，动画不跑
            window.requestAnimationFrame(function () {
                place(S.shell, coverRect);
                S.shell.style.borderRadius = radiusOf(coverEl);
                S.shellVeil.style.opacity = '1';
            });
        }

        ghosts.forEach(layGhost);

        window.requestAnimationFrame(function () {
            ghosts.forEach(function (g) { flyGhost(g, dur, ease); });
        });

        S.scrim.classList.remove('is-on');

        /*
         * 网格从这里就开始醒过来，和飞行同时进行（两者都是 --aw-dur，一起到站）：
         * 封面往回飞的同时，模糊退掉、亮度回来、邻居也各自缩回原位。
         *
         * 这一整片都**不会挪动被点开的那张卡片**：网格自己不再缩放，卡片这边
         * 只有邻居才有外推位移，被点开那张的位移已经在 pushNeighbours() 里清零。
         * 所以替身照样能严丝合缝地落回卡片上——换成"等落位了再解除"，就又是
         * 封面先归位、墙再醒来的两段式了。
         */
        S.grid.classList.remove('is-behind');

        S.timer = window.setTimeout(function () {
            S.timer = null;

            S.detail.hidden = true;
            S.detail.classList.remove('is-closing');
            S.detail.style.visibility = '';
            hideGhosts();
            S.scrim.hidden = true;

            card.classList.remove('is-flying');

            S.openCard = null;
            S.busy = false;

            unlockScroll();

            try {
                card.focus({ preventScroll: true });
            } catch (e) {
                card.focus();
            }

            // Back / Forward 在两个相册之间切换：关完这一个接着开下一个
            if (S.pendingOpen) {
                var next = cardFor(S.pendingOpen);
                S.pendingOpen = null;
                if (next) {
                    open(next, true);
                }
            }
        }, dur + 30);
    }

    /**
     * 把滚动条槽的实宽报给 CSS 的 --aw-gutter。
     *
     * 详情面板在滚动容器里是居中的，而滚动条（或 scrollbar-gutter 预留的槽）
     * 会吃掉容器右边一条，面板因此整体左移半个槽宽。关闭按钮的坐标是从视口
     * 算的，不知道这件事就会和面板差几像素。
     *
     * 槽宽按平台而变（覆盖式滚动条是 0，Windows 经典滚动条十几像素），
     * 写死不行，只能实测。
     */
    function syncGutter() {
        var sc = S.detailScroll;

        if (!sc) {
            return;
        }

        var gutter = sc.offsetWidth - sc.clientWidth;

        document.documentElement.style.setProperty(
            '--aw-gutter',
            Math.max(0, gutter) + 'px'
        );
    }

    function panelRadiusOf() {
        var inner = S.detail.querySelector('.aw-detail__inner');
        return inner ? radiusOf(inner) : '';
    }

    // ────────────────────────────────────────────────────────
    // 单张照片详情
    // ────────────────────────────────────────────────────────

    /**
     * 照片那一层的状态。
     *
     * 它和相册详情是两层独立的浮层：相册那层是"墙"，这层是"把墙上的某一张
     * 取下来裱进框里"。所以它有自己的开合、自己的飞行外壳，只在关相册时被
     * 一并收走（见 hidePhotoNow）。
     *
     * 飞行算法和封面那套不一样：封面要改盒子尺寸（两端比例不同，得交给
     * background-size 重新裁切），这边两端是**同一个比例**——缩略图不裁切、
     * 框又是照着照片比例量的，所以一个等比 scale 就够了，全程不触发布局。
     */
    var V = {
        el: null,
        backdrop: null,
        frame: null,
        stage: null,
        img: null,
        fly: null,
        flyImg: null,

        open: false,
        /** 墙上被取下来的是哪一张（.aw-photo） */
        item: null,
        /** 它在这一篇照片里的下标，也是地址里那个序号减一 */
        index: -1,
        /** 原图尺寸。窗口尺寸一变要重算框，那会儿图可能已经不在手边了 */
        natW: 0,
        natH: 0,

        /** 框内照片的放缩和平移，算式是 translate(tx, ty) scale(s)，原点在左上角 */
        scale: 1,
        tx: 0,
        ty: 0,
        /** 落位后舞台的视口矩形。放缩要以它为坐标系，飞在半路时量不得 */
        stageRect: null,

        busy: false,
        timer: null,
        fadeTimer: null,

        /** 按下的指针，按 pointerId 存。两根以上才走双指 */
        pointers: {},
        pinch: null,
        drag: null,
        /** 上一次点击（或轻触）的时间与位置，用来认双击 */
        lastTap: { t: 0, x: 0, y: 0 }
    };

    /** 框内最多放大到几倍。再大就是一片马赛克了 */
    var MAX_SCALE = 6;

    /** 双击放到的倍数。一般照片在屏幕上已经是缩过的，2.5 倍差不多是 1:1 */
    var DBL_SCALE = 2.5;

    /**
     * 展开一张照片。
     *
     * @param {Element} item 墙上那个 .aw-photo
     * @param {boolean} fromHistory true = 由后退/前进或直接开地址引发，不再写 history
     */
    function openPhoto(item, fromHistory) {
        if (!V.el || V.open || V.busy || S.busy || !S.openCard) {
            return;
        }

        var album = S.data[S.openCard.getAttribute('data-cid')];
        var index = parseInt(item.getAttribute('data-aw-index'), 10);
        var url = album && album.photos ? album.photos[index] : null;
        var src = item.querySelector('img');
        var from = rect(src);

        // 缩略图还没排进列（宽 0）时量不出起点，这一趟飞不起来
        if (!url || isNaN(index) || from.width <= 0 || !V.flyImg) {
            return;
        }

        V.open = true;
        V.busy = true;
        V.item = item;
        V.index = index;
        V.natW = src.naturalWidth || 0;
        V.natH = src.naturalHeight || 0;

        if (!fromHistory) {
            setPhotoHash(index);
        }

        // 原图还没解码完（点得太快）时拿不到真实比例，退回缩略图此刻的长宽比：
        // 缩略图是不裁切的（.aw-photo img 是 width:100%; height:auto），
        // 它此刻的长宽比就是原图的
        var ratio = (V.natW > 0 && V.natH > 0)
            ? V.natW / V.natH
            : (from.height > 0 ? from.width / from.height : 1.5);

        var box = fitRect(ratio, V.natW, V.natH);

        V.frame.style.setProperty('--aw-mat', box.mat + 'px');
        V.frame.style.width = box.frameW + 'px';
        V.frame.style.height = box.frameH + 'px';
        V.stage.style.width = box.stageW + 'px';
        V.stage.style.height = box.stageH + 'px';

        resetZoom();

        // 框先摆出来才量得到终点。入场只有透明度、没有位移，所以这一帧量到的
        // 就是它最终的矩形，不必等过渡跑完
        V.el.hidden = false;
        V.el.classList.remove('is-closing', 'is-settled', 'is-on');
        void V.el.offsetWidth;

        V.stageRect = rect(V.stage);

        // 同一张图，缩略图那份多半已经在缓存里了，这一行不会等下载。
        // 挂得越早，飞行途中越不可能空着
        V.img.src = url;
        V.flyImg.src = url;

        var to = V.stageRect;

        // 外壳的盒子就是终点那块舞台，起点靠 scale 缩回缩略图——这样一路都是
        // 按大图渲染再缩小，比"按缩略图尺寸放大"清楚
        V.fly.hidden = false;
        V.fly.classList.remove('is-fading');
        V.fly.style.opacity = '';
        V.fly.style.width = to.width + 'px';
        V.fly.style.height = to.height + 'px';
        V.fly.style.transition = 'none';
        V.fly.style.transform = flightFrom(from, to);
        V.flyImg.style.transition = 'none';
        V.flyImg.style.transform = 'none';

        // 被取走的那一张原地留白，墙不塌——回程要落回这个位置
        item.classList.add('is-flying');

        V.el.classList.add('is-on');

        // 两层 dialog 同时开着的时候，读屏会跑去念身后那面墙。把它按下去，
        // 关闭时再放回来（顺序要紧：先摘掉 aria-hidden，再把焦点还给缩略图）
        if (S.detail) {
            S.detail.setAttribute('aria-hidden', 'true');
        }

        var dur = readDur();
        var ease = readEase();

        window.requestAnimationFrame(function () {
            V.fly.style.transition = 'transform ' + dur + 'ms ' + ease;
            V.fly.style.transform = flightFrom(to, to);
            V.timer = window.setTimeout(settlePhoto, dur + 30);
        });
    }

    /** 按照片在列表里的下标展开（地址、后退、前进都走这条路） */
    function openPhotoByIndex(index, fromHistory) {
        var item = S.wallItems[index];

        if (item) {
            openPhoto(item, fromHistory);
        }
    }

    /**
     * 外壳的落位算式：盒子的尺寸恒等于 to，位移和缩放全在 transform 上。
     *
     * 缩放倍数取两端的**宽**之比就够了——两端比例相同（见上面那条注释），
     * 宽和高是同一个倍数。原点是左上角，所以位移直接就是 to 的左上角。
     */
    function flightFrom(from, to) {
        var k = to.width > 0 ? from.width / to.width : 1;

        return 'translate(' + from.left + 'px,' + from.top + 'px) scale(' + k + ')';
    }

    /**
     * 框该多大。
     *
     * 先按照片比例塞进"视口减掉留白"的那块地方；原图比这块地方还小就按原样
     * 裱——硬放大只会糊，一张 800px 的图裱满一屏白边也不像话。
     *
     * 留白必须留够：框外那一圈是"点这里退出"的落点，框贴着屏幕边就没地方点了。
     *
     * @return {{stageW: number, stageH: number, frameW: number, frameH: number, mat: number}}
     */
    function fitRect(ratio, natW, natH) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        var padX = Math.max(24, Math.min(vw * .07, 96));
        var padY = Math.max(24, Math.min(vh * .09, 96));
        // 装裱白边的宽窄。跟着屏幕短边走，小屏上十几像素，大屏上封顶 26
        var mat = Math.round(Math.max(10, Math.min(Math.min(vw, vh) * .022, 26)));

        // 极端窄的窗口下别算出 0 或者负数
        var maxW = Math.max(80, vw - padX * 2 - mat * 2);
        var maxH = Math.max(80, vh - padY * 2 - mat * 2);

        var w = maxW;
        var h = w / ratio;

        if (h > maxH) {
            h = maxH;
            w = h * ratio;
        }

        // 小图不放大
        if (natW > 0 && natH > 0 && w > natW) {
            w = natW;
            h = w / ratio;
        }

        w = Math.round(w);
        h = Math.round(h);

        return {
            stageW: w,
            stageH: h,
            frameW: w + mat * 2,
            frameH: h + mat * 2,
            mat: mat
        };
    }

    /**
     * 窗口尺寸变了之后重算框的大小（转屏、拉窗口）。
     *
     * 只在没放大的时候重排：手机地址栏一收一放就会发 resize，那会儿把照片
     * 重新摆一遍，正在看的位置会被抖掉。已经放大了就干脆不动。
     */
    function refitPhoto() {
        if (!V.open || V.busy || V.scale > 1.001) {
            return;
        }

        var stage = rect(V.stage);
        var ratio = (V.natW > 0 && V.natH > 0)
            ? V.natW / V.natH
            : (stage.height > 0 ? stage.width / stage.height : 1.5);
        var box = fitRect(ratio, V.natW, V.natH);

        V.frame.style.setProperty('--aw-mat', box.mat + 'px');
        V.frame.style.width = box.frameW + 'px';
        V.frame.style.height = box.frameH + 'px';
        V.stage.style.width = box.stageW + 'px';
        V.stage.style.height = box.stageH + 'px';

        V.stageRect = rect(V.stage);
        resetZoom();
    }

    /**
     * 落位：把照片从飞行外壳手里交回给框里的真身。
     *
     * 和相册那层同理——两边是同一张图、同一个矩形，这一换本身看不见；之所以
     * 还要交叉淡化，是为了化掉外壳身上那点缩放糊。
     */
    function settlePhoto() {
        V.timer = null;

        V.el.classList.add('is-settled');
        V.busy = false;

        V.fly.style.transition = '';
        V.fly.classList.add('is-fading');

        V.fadeTimer = window.setTimeout(function () {
            V.fadeTimer = null;
            V.fly.hidden = true;
            V.fly.classList.remove('is-fading');
        }, readMs('--aw-cross', DEFAULTS.cross) + 20);

        if (V.frame) {
            try {
                V.frame.focus({ preventScroll: true });
            } catch (e) {
                V.frame.focus();
            }
        }
    }

    /**
     * 关闭请求。
     *
     * 和相册那层不一样：这里**不能**走 history.back()（会招来 pjax 重载，
     * 理由见 setPhotoHash）。地址里那段照片序号直接用 replaceState 抹掉，
     * 然后就地起回程动画——全程没有 popstate，也就没人来打断它。
     */
    function requestClosePhoto() {
        if (!V.open || V.busy) {
            return;
        }

        setPhotoHash(null);
        closePhoto();
    }

    /**
     * 收回墙上。
     *
     * 飞行从"框里此刻的样子"接着走：外面那层的盒子还是舞台那一块，里面那层
     * 带着当前的放缩。两层各自收回去，照片就是边缩边从放大状态里退出来，
     * 落回墙上那一帧正好是整张缩略图。
     */
    function closePhoto() {
        if (!V.open) {
            return;
        }

        stopViewerTimers();
        V.busy = true;

        var item = V.item;
        var src = item ? item.querySelector('img') : null;
        var to = rect(src);
        var stage = V.stageRect || rect(V.stage);
        var dur = readDur();
        var ease = readEase();

        V.el.classList.remove('is-settled', 'is-on');
        V.el.classList.add('is-closing');

        if (src && to.width > 0 && stage.width > 0) {
            V.fly.hidden = false;
            V.fly.classList.remove('is-fading');
            V.fly.style.opacity = '';
            V.fly.style.width = stage.width + 'px';
            V.fly.style.height = stage.height + 'px';

            // 起点：盒子已经在舞台上，里面那层带着框里此刻的放缩
            V.flyImg.style.transition = 'none';
            V.flyImg.style.transform = zoomTransform();
            V.fly.style.transition = 'none';
            V.fly.style.transform = flightFrom(stage, stage);

            // 上面这次赋值必须真的落下去，下一帧改终点才会跑过渡
            void V.fly.offsetWidth;

            V.fly.style.transition = 'transform ' + dur + 'ms ' + ease;
            V.flyImg.style.transition = 'transform ' + dur + 'ms ' + ease;
            V.fly.style.transform = flightFrom(to, stage);
            V.flyImg.style.transform = 'none';
        }

        V.timer = window.setTimeout(function () {
            V.timer = null;

            hidePhotoNow();

            if (item) {
                try {
                    item.focus({ preventScroll: true });
                } catch (e) {
                    item.focus();
                }
            }
        }, dur + 30);
    }

    /**
     * 立刻把照片那层收干净（不走动画）。
     *
     * 两种时候用得上：关相册、以及 pjax 换页。两种情况下背景里那面墙都要变，
     * 飞行没有落点可言，只能硬收。
     */
    function hidePhotoNow() {
        stopViewerTimers();

        if (V.item) {
            V.item.classList.remove('is-flying');
        }

        if (V.el) {
            V.el.hidden = true;
            V.el.classList.remove('is-on', 'is-closing', 'is-settled', 'is-zoomed', 'is-dragging');
        }

        if (V.fly) {
            V.fly.hidden = true;
            V.fly.classList.remove('is-fading');
        }

        // 焦点马上要还回墙上的缩略图，得赶在那之前把墙放出来
        if (S.detail) {
            S.detail.removeAttribute('aria-hidden');
        }

        V.pointers = {};
        V.pinch = null;
        V.drag = null;
        V.open = false;
        V.busy = false;
        V.item = null;
        V.index = -1;

        resetZoom();
    }

    function stopViewerTimers() {
        if (V.timer) {
            window.clearTimeout(V.timer);
            V.timer = null;
        }

        if (V.fadeTimer) {
            window.clearTimeout(V.fadeTimer);
            V.fadeTimer = null;
        }
    }

    // ── 框内的放缩与平移 ──────────────────────────────────────

    function zoomTransform() {
        return 'translate(' + V.tx + 'px,' + V.ty + 'px) scale(' + V.scale + ')';
    }

    function resetZoom() {
        V.scale = 1;
        V.tx = 0;
        V.ty = 0;
        applyZoom();
    }

    function applyZoom() {
        if (!V.img || !V.el) {
            return;
        }

        // 这一步是跟手的，不能有过渡——变形的过渡由样式表管，而样式表里
        // 只给了 opacity，正是为了这里
        V.img.style.transform = zoomTransform();
        V.el.classList.toggle('is-zoomed', V.scale > 1.001);
    }

    /**
     * 把照片摁在框里。
     *
     * 照片和舞台是同一个尺寸、同一个比例，放大 s 倍之后超出来的那部分正好是
     * 舞台的 (s - 1) 倍；原点又在左上角，所以平移的余量就是从 -max 到 0。
     * s = 1 时余量是 0，照片只能严丝合缝地待在框里。
     */
    function clampPan() {
        var w = V.stageRect ? V.stageRect.width : 0;
        var h = V.stageRect ? V.stageRect.height : 0;

        var maxX = w * (V.scale - 1);
        var maxY = h * (V.scale - 1);

        V.tx = Math.min(0, Math.max(-maxX, V.tx));
        V.ty = Math.min(0, Math.max(-maxY, V.ty));
    }

    /**
     * 以某个视口坐标为锚点放缩：那个点底下的像素放缩前后是同一个。
     *
     * 算式来自 q = p * s + t（原点在左上角）。要让 q 不动：
     *   p * s0 + t0 = p * s1 + t1   →   t1 = t0 + p * (s0 - s1)
     */
    function zoomAt(clientX, clientY, factor) {
        var s0 = V.scale;
        var s1 = Math.min(MAX_SCALE, Math.max(1, s0 * factor));

        if (Math.abs(s1 - s0) < 1e-4) {
            return;
        }

        var stage = V.stageRect || rect(V.stage);
        var px = clientX - stage.left;
        var py = clientY - stage.top;

        V.scale = s1;
        V.tx = V.tx + px * (s0 - s1);
        V.ty = V.ty + py * (s0 - s1);

        clampPan();
        applyZoom();
    }

    /**
     * 滚轮放缩。
     *
     * 触控板的双指捏合在浏览器里就是"带 ctrlKey 的滚轮"，而且它每一步的 delta
     * 比鼠标滚轮小一个量级，两边的系数得分开给。
     */
    function onWheel(e) {
        if (!V.open || V.busy) {
            return;
        }

        e.preventDefault();

        var step = e.ctrlKey ? .012 : .0016;

        // deltaMode：0 = 像素、1 = 行、2 = 页。后两种要折成像素，
        // 不然鼠标滚一格就能把照片顶到最大
        var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? window.innerHeight : 1);

        // 用指数而不是加法：每一步按当前倍数乘一个系数，从小图放到大图和
        // 从大图缩回小图的手感才是对称的
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * step));
    }

    function onPointerDown(e) {
        if (!V.open || V.busy) {
            return;
        }

        V.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };

        if (pointerPoints().length >= 2) {
            // 第二根指头按下来，单指那段拖拽作废，改走双指
            V.drag = null;
            startPinch();
        } else {
            V.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
        }

        // 抓住指针：手滑出框外（甚至滑出窗口）也要继续收到事件
        try {
            V.stage.setPointerCapture(e.pointerId);
        } catch (err) {
            // 某些浏览器对已经释放的指针会抛，不值得为它中断
        }

        // 不拦的话，触摸端会在放缩的同时把页面滚走
        e.preventDefault();
    }

    function onPointerMove(e) {
        if (!V.open || V.busy) {
            return;
        }

        if (V.pointers[e.pointerId]) {
            V.pointers[e.pointerId].x = e.clientX;
            V.pointers[e.pointerId].y = e.clientY;
        }

        if (V.pinch && pointerPoints().length >= 2) {
            movePinch();
            e.preventDefault();
            return;
        }

        // 没放大时照片就是框那么大，没有可挪的余量，也就没有拖拽
        if (V.drag && V.drag.id === e.pointerId && V.scale > 1.001) {
            V.tx += e.clientX - V.drag.x;
            V.ty += e.clientY - V.drag.y;
            V.drag.moved += Math.abs(e.clientX - V.drag.x) + Math.abs(e.clientY - V.drag.y);
            V.drag.x = e.clientX;
            V.drag.y = e.clientY;

            clampPan();
            applyZoom();
            V.el.classList.add('is-dragging');
            e.preventDefault();
        }
    }

    function onPointerUp(e) {
        if (!V.open) {
            return;
        }

        var drag = V.drag && V.drag.id === e.pointerId ? V.drag : null;

        delete V.pointers[e.pointerId];
        V.el.classList.remove('is-dragging');

        try {
            V.stage.releasePointerCapture(e.pointerId);
        } catch (err) {
            // 没抓住的时候释放会抛，忽略
        }

        if (V.pinch && pointerPoints().length < 2) {
            V.pinch = null;
        }

        // 双指里松开一根，剩下那根接着当拖拽用：不接这一手的话，放大了之后
        // 想挪位置得把手抬干净再按一次，手感是断的
        if (!drag && !V.drag) {
            var rest = pointerPoints();

            if (rest.length === 1) {
                V.drag = { id: rest[0].id, x: rest[0].x, y: rest[0].y, moved: 0 };
            }
        }

        if (drag) {
            V.drag = null;
            detectDoubleTap(e, drag.moved);
        }
    }

    /** 指针被系统收走（来电、手势介入）。状态清干净，别留下按住的假象 */
    function onPointerCancel(e) {
        delete V.pointers[e.pointerId];
        V.pinch = null;
        V.drag = null;

        if (V.el) {
            V.el.classList.remove('is-dragging');
        }
    }

    /**
     * 双击（双轻触）在"整张"和"看清"之间来回。
     *
     * 自己按时间戳认，不用 dblclick：pointerdown 里的 preventDefault 会把
     * 浏览器的兼容鼠标事件掐掉，dblclick 未必到得了这一层。
     */
    function detectDoubleTap(e, moved) {
        var now = Date.now();

        var dbl = moved < 8
            && now - V.lastTap.t < 320
            && Math.abs(e.clientX - V.lastTap.x) < 40
            && Math.abs(e.clientY - V.lastTap.y) < 40;

        V.lastTap = { t: now, x: e.clientX, y: e.clientY };

        if (!dbl) {
            return;
        }

        // 认出来了就把时间戳清掉，免得三连击又切一次
        V.lastTap = { t: 0, x: 0, y: 0 };

        if (V.scale > 1.001) {
            resetZoom();
        } else {
            zoomAt(e.clientX, e.clientY, DBL_SCALE / V.scale);
        }
    }

    /**
     * 双指放缩的基准：两指的距离和中点。
     *
     * 起手时把当前的放缩也一并存下来，之后每一次移动都从这份基准**重算**——
     * 一步步累加会把 clampPan 削掉的位移也记进去，手势一松手照片就慢慢跑偏。
     */
    function startPinch() {
        var pts = pointerPoints();

        if (pts.length < 2) {
            return;
        }

        // 上过双指就不再认双击了：双指松开之后剩下的那根会接手拖拽，
        // 抬手时走的还是双击那条判定，不掐掉的话"刚点过一下又捏一下"
        // 会在收手时莫名其妙地放大一步
        V.lastTap = { t: 0, x: 0, y: 0 };

        V.pinch = {
            dist: distance(pts[0], pts[1]) || 1,
            cx: (pts[0].x + pts[1].x) / 2,
            cy: (pts[0].y + pts[1].y) / 2,
            scale: V.scale,
            tx: V.tx,
            ty: V.ty
        };
    }

    function movePinch() {
        var pts = pointerPoints();

        if (pts.length < 2 || !V.pinch) {
            return;
        }

        var a = pts[0];
        var b = pts[1];
        var s = Math.min(MAX_SCALE, Math.max(1, V.pinch.scale * (distance(a, b) / V.pinch.dist)));
        var mx = (a.x + b.x) / 2;
        var my = (a.y + b.y) / 2;

        var stage = V.stageRect || rect(V.stage);
        var px = V.pinch.cx - stage.left;
        var py = V.pinch.cy - stage.top;

        V.scale = s;
        // 以起手时两指的中点为锚做放缩，再把中点这一路的位移加上去——双指
        // 既能放缩也能平移，放大之后要挪位置全靠后半截
        V.tx = V.pinch.tx + px * (V.pinch.scale - s) + (mx - V.pinch.cx);
        V.ty = V.pinch.ty + py * (V.pinch.scale - s) + (my - V.pinch.cy);

        clampPan();
        applyZoom();
    }

    /**
     * 当下按着的指针，各带一个 id。
     *
     * 带 id 是因为双指里松掉一根时要认出剩下的是哪一根——它得接过拖拽继续用。
     * for...in 在整数样子的键上是按数值升序走的，所以这里的顺序是稳的，
     * pts[0] / pts[1] 两次调用之间不会自己换位置。
     */
    function pointerPoints() {
        var pts = [];

        for (var id in V.pointers) {
            if (Object.prototype.hasOwnProperty.call(V.pointers, id)) {
                pts.push({
                    id: parseInt(id, 10),
                    x: V.pointers[id].x,
                    y: V.pointers[id].y
                });
            }
        }

        return pts;
    }

    function distance(a, b) {
        var dx = a.x - b.x;
        var dy = a.y - b.y;

        return Math.sqrt(dx * dx + dy * dy);
    }

    function bindViewer() {
        // 点框外退出。挂在最外层而不是压暗层上：压暗层是它的子元素，但框也在
        // 里面，用"点在不在框里"来判比算谁盖着谁稳
        V.el.addEventListener('click', function (e) {
            if (V.frame.contains(e.target)) {
                return;
            }

            requestClosePhoto();
        });

        V.el.addEventListener('wheel', onWheel, { passive: false });

        V.stage.addEventListener('pointerdown', onPointerDown);
        V.stage.addEventListener('pointermove', onPointerMove);
        V.stage.addEventListener('pointerup', onPointerUp);
        V.stage.addEventListener('pointercancel', onPointerCancel);

        // 图片的原生拖拽会把指针事件整条吃掉。模板上写的 draggable="false"
        // 是主防线，这里再兜一道
        V.stage.addEventListener('dragstart', function (e) {
            e.preventDefault();
        });
    }

    /**
     * 缩略图的读屏标签。文案放在模板上（--aw-label），翻译跟着 PHP 那边走，
     * JS 里不再留一份中文。
     */
    function photoLabel(index, total) {
        var tpl = V.el ? (V.el.getAttribute('data-aw-label') || '') : '';

        return tpl
            .replace('%1$d', String(index + 1))
            .replace('%2$d', String(total));
    }

    // ────────────────────────────────────────────────────────
    // 内容填充
    // ────────────────────────────────────────────────────────

    /**
     * 把详情面板的内容铺上。
     *
     * 标题、日期、张数这三段**文字取自卡片自己的 DOM**，而不是另拼一份：替身
     * 是从卡片飞过去的，落位那一刻要和详情里真身的文字逐字重合，两份字符串只要
     * 差一个字符（日期格式不同、复数形式不同、"张"和"张照片"用词不同）宽度就对
     * 不上，看上去就是文字在落位时"跳"了一下。照抄卡片上那一份，这种事从根上
     * 不会发生。
     */
    function fill(album, card) {
        S.detailTitle.textContent = album.title || '';
        S.detailDate.textContent = text(card, '.aw-card__date');

        var count = text(card, '.aw-card__count');

        S.detailCount.textContent = count;
        // 卡片上没有张数（0 张）时，分隔号也没画；详情这边跟着一起收，
        // 否则会剩下一个孤零零的「·」
        S.detailSep.hidden = count === '';
        S.detailCount.hidden = count === '';

        if (album.permalink) {
            S.detailLink.href = album.permalink;
            S.detailLink.hidden = false;
        } else {
            S.detailLink.hidden = true;
        }

        // 替身的内容在 open()/close() 里由 ghost() 从卡片上取，
        // 这里不用管；只要保证两边看到的是同一份 DOM 就行

        if (album.cover) {
            S.hero.hidden = false;
            // 必须赶在量尺寸之前把 src 挂上，浏览器越早开始下越好
            S.heroImg.src = album.cover;
        } else {
            S.hero.hidden = true;
            S.heroImg.removeAttribute('src');
        }

        // 照片先造成元素收进 wallItems，摆进哪一列交给 layoutWall()。
        // src 在这个循环里就挂上，能早一点开始下载。
        S.photos.textContent = '';
        S.wallItems = [];
        S.wallCols = 0;

        var photos = album.photos || [];

        for (var i = 0; i < photos.length; i++) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'aw-photo';
            // 下标是照片在这一篇里的序号，也是 hash 里那个数减一：点击、
            // 直接开地址、前后退三条路都得按它找回墙上的这一张
            item.setAttribute('data-aw-index', String(i));

            // 模板里没有照片那层时（旧版模板被缓存住了）photoLabel 给空串，
            // 那就别写 aria-label——空标签比没有标签更糟，读屏会念出一个空按钮
            var label = photoLabel(i, photos.length);

            if (label) {
                item.setAttribute('aria-label', label);
            }
            // 序号只递增到 11：41 张照片按每张 26ms 排下去最后一张要等一秒
            item.style.setProperty('--aw-i', String(Math.min(i, 11)));

            var img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = photos[i];

            // 用 this 而不是闭包里的 item：循环变量是 var，闭包会把最后一张
            // 当成所有张
            item.addEventListener('click', function () {
                openPhoto(this);
            });

            item.appendChild(img);
            S.wallItems.push(item);
        }

        layoutWall();
        S.empty.hidden = photos.length > 0;
    }

    /**
     * 照片墙该分几列。
     *
     * 和原来 CSS 那条 columns: 4 170px 同一套算式：最多 4 列、每列不窄于 170px，
     * 面板窄到放不下 4 列时自动减到 3 列、2 列。
     *
     * 详情还是 display: none 的时候量不到宽度（fill() 里那一次就是这样），
     * 先按桌面常见的 4 列摆着；open() 把详情摆出来后会再调一次 layoutWall()，
     * 那一次量到的是真值，中间那一步用户看不到。
     */
    function wallCols() {
        var width = S.photos ? S.photos.clientWidth : 0;

        if (!width) {
            return WALL_MAX_COLS;
        }

        // 间距跟着 CSS 走，别在这里再写死一份
        var gap = parseFloat(window.getComputedStyle(S.photos).columnGap) || 0;
        var fit = Math.floor((width + gap) / (WALL_MIN_COL_W + gap));

        return Math.max(1, Math.min(WALL_MAX_COLS, fit));
    }

    /**
     * 把照片摆进各列。
     *
     * 分配方式是 i % 列数轮流塞，**不是**"填满一列再换下一列"——后者会让
     * 5/6/9 张照片排出 2/2/1/0 这种形状，最右一列整个空掉（这正是原来用 CSS
     * 多列布局时"第一行右边空一个"的原因，详见 album.css 里 .aw-photos 那段）。
     *
     * 列数没变就不动 DOM：重排会让已经加载好的图片重新解码，也会打断入场动画。
     */
    function layoutWall() {
        var items = S.wallItems;

        if (!S.photos || !items || items.length === 0) {
            return;
        }

        var cols = wallCols();

        if (S.wallCols === cols && S.photos.childElementCount === cols) {
            return;
        }

        S.wallCols = cols;
        S.photos.textContent = '';

        var c;
        var frags = [];

        for (c = 0; c < cols; c++) {
            frags.push(document.createDocumentFragment());
        }

        for (var i = 0; i < items.length; i++) {
            frags[i % cols].appendChild(items[i]);
        }

        for (c = 0; c < cols; c++) {
            var col = document.createElement('div');
            col.className = 'aw-col';
            col.appendChild(frags[c]);
            S.photos.appendChild(col);
        }
    }

    /**
     * 悬停预热。同一张卡片只做一次。
     */
    function warm(card) {
        if (card.hasAttribute('data-aw-warm')) {
            return;
        }
        card.setAttribute('data-aw-warm', '1');

        var album = S.data[card.getAttribute('data-cid')];
        if (!album) {
            return;
        }

        var urls = [];
        if (album.cover) {
            urls.push(album.cover);
        }
        urls = urls.concat((album.photos || []).slice(0, 3));

        urls.forEach(function (url) {
            var img = new Image();
            img.decoding = 'async';
            img.src = url;
        });
    }

    // ────────────────────────────────────────────────────────
    // 邻居外推
    // ────────────────────────────────────────────────────────

    /**
     * 让被点开的那张卡片周围的邻居朝各自远离点击点的方向挪一点。
     *
     * 单独一个网格模糊只会显得"变暗了"，加上这个径向的外推，才读得出"被撑开/
     * 裂开"的力气。每个卡片挪多少写进它自己的 --aw-push-* 变量，CSS 那边统一读。
     */
    function pushNeighbours(cardRect) {
        if (!S.grid) {
            return;
        }

        var cx = cardRect.left + cardRect.width / 2;
        var cy = cardRect.top + cardRect.height / 2;

        S.cards.forEach(function (card) {
            if (card.classList.contains('is-flying')) {
                // 被点开的那张卡片自己不外推：它是这一轮动画的锚点，位置必须
                // 一动不动——替身的起点和终点都是照它的位置量的，它挪一下，
                // 落位就差那么多。这里显式清零，是防它上一轮当邻居时留下的值
                // 还在（--aw-push-* 是写在行内样式上的，不会自己消失）
                card.style.setProperty('--aw-push-x', '0px');
                card.style.setProperty('--aw-push-y', '0px');
                return;
            }

            // 必须在加上 .is-behind 之前量，否则量到的是已经位移过的位置
            var r = rect(card);
            var vx = (r.left + r.width / 2) - cx;
            var vy = (r.top + r.height / 2) - cy;
            var len = Math.sqrt(vx * vx + vy * vy) || 1;

            card.style.setProperty('--aw-push-x', (vx / len * 12).toFixed(1) + 'px');
            card.style.setProperty('--aw-push-y', (vy / len * 12).toFixed(1) + 'px');
        });

        S.grid.classList.add('is-behind');
    }

    // ────────────────────────────────────────────────────────
    // history
    // ────────────────────────────────────────────────────────

    /**
     * 从 hash 里读当前该展开什么。
     *
     *  - #album-47      相册
     *  - #album-47-p3   相册里的第 3 张照片（从 1 数起）
     *
     * 照片那一层也进地址栏，是为了能直接分享"这一张"；它不占历史记录，
     * 所以后退键看到的只有相册那一段（详见 setPhotoHash）。两层合在一个
     * hash 里而不是各写各的，是因为浏览器里只有一个 hash。
     *
     * 用 hash 而不是 history.state 是有意的：Jasmine 的 pjax 在滚动时会对
     * 当前历史记录做 replaceState({scrollY})，那会把我们写进去的 state 覆盖掉。
     * hash 不会被它碰，而且 Jasmine 的 onPopState 对纯 hash 变化是直接 return 的
     * （它自己也注释了"如果仅仅是 hash 变化，不执行 PJAX 加载"），正好不打架。
     */
    function hashState() {
        var m = /^#album-(\d+)(?:-p(\d+))?$/.exec(window.location.hash || '');

        if (!m) {
            return null;
        }

        return { cid: m[1], photo: m[2] ? parseInt(m[2], 10) : null };
    }

    function albumFromHash() {
        var state = hashState();

        return state ? state.cid : null;
    }

    function pushHash(cid) {
        var slug = '#album-' + cid;

        if (window.location.hash === slug) {
            return;
        }

        try {
            history.pushState({ aw: cid }, '', slug);
        } catch (e) {
            // 某些场景下 pushState 会抛（比如沙箱化的 iframe）。退化成"关不掉
            // 但能开"总好过整个插件挂掉
        }
    }

    /**
     * 把照片的序号写进地址——只改地址，**不**新增历史记录。
     *
     * 这里刻意不用 pushState。Jasmine 的 pjax 拦了 popstate，却没有"纯 hash
     * 变化就跳过"的判断（主题里当前这版 pjax.js 的 onPopState 是无条件
     * fetch + 整段替换 #middle 的）。只要 push 进去一条记录，"关掉照片"就得走
     * history.back()，而那一按会招来那次重载：
     *
     *   回程动画刚飞一半 → #middle 被换成一份新 DOM（浮层被 dropOrphans 收走）
     *   → 接着 init() 照 hash 里那个 #album-N 把相册整个重新展开一遍
     *
     * 用户看到的是"关掉照片，整面墙闪一下又自己打开"。所以这一层只改地址、
     * 不动历史：代价是照片开着时按后退退的是相册那一层（照片一并收走），
     * 换来的是开合全程不被打断。
     *
     * @param {number|null} index 照片下标；null = 只留相册那一段
     */
    function setPhotoHash(index) {
        var cid = S.openCard ? S.openCard.getAttribute('data-cid') : null;

        if (!cid) {
            return;
        }

        replaceHash('#album-' + cid + (index === null ? '' : '-p' + (index + 1)));
    }

    /**
     * 就地改 hash，不留历史记录（也就不会有 popstate）。
     *
     * 把 history.state 原样传回去：Jasmine 用它存滚动位置，抹掉的话它那套
     * 滚动记忆会连当前这条记录一起失效。
     */
    function replaceHash(slug) {
        if (window.location.hash === slug) {
            return;
        }

        try {
            history.replaceState(history.state, '', slug);
        } catch (e) {
            // 沙箱化的 iframe 里 replaceState 会抛。地址栏不准不影响开合
        }
    }

    /**
     * 后退 / 前进。
     *
     * 地址里现在有两位信息（相册、照片），要按"从外往里"的顺序收拾：相册
     * 换了或者要关，照片那层先无条件收掉；相册没变，才只看照片那层。
     */
    function onPopState() {
        var state = hashState();
        var cid = state ? state.cid : null;
        var photo = state ? state.photo : null;
        var current = S.openCard ? S.openCard.getAttribute('data-cid') : null;

        if (cid !== current) {
            // 相册要换或者要关：照片那层硬收，不给它飞回去的余地——背景里
            // 那面墙马上就要换成另一面（或者收起来）了，落点下一帧就不在
            if (V.open) {
                hidePhotoNow();
            }

            if (!cid) {
                if (S.openCard) {
                    close();
                }
                return;
            }

            var card = cardFor(cid);

            if (!card) {
                return;
            }

            // 跟着一起开的那张照片，等相册落位后由 settle() 取走
            S.pendingPhoto = photo === null ? null : photo - 1;

            if (S.openCard) {
                // 正在看另一个相册：等它关完再开这一个
                S.pendingOpen = cid;
                close();
            } else {
                open(card, true);
            }

            return;
        }

        if (!cid) {
            return;
        }

        // 相册没变，只看照片那层要开还是要关
        if (photo === null) {
            if (V.open) {
                closePhoto();
            }
        } else if (!V.open) {
            openPhotoByIndex(photo - 1, true);
        }
    }

    function cardFor(cid) {
        for (var i = 0; i < S.cards.length; i++) {
            if (S.cards[i].getAttribute('data-cid') === String(cid)) {
                return S.cards[i];
            }
        }

        return null;
    }

    // ────────────────────────────────────────────────────────
    // 工具
    // ────────────────────────────────────────────────────────

    function readData(app) {
        var node = app.querySelector('.aw-data');

        if (!node) {
            return {};
        }

        try {
            return JSON.parse(node.textContent || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function toArray(list) {
        return Array.prototype.slice.call(list);
    }

    function rect(el) {
        return el ? el.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
    }

    /** 把元素钉到视口坐标的某个矩形上 */
    function place(el, r) {
        el.style.top = r.top + 'px';
        el.style.left = r.left + 'px';
        el.style.width = r.width + 'px';
        el.style.height = r.height + 'px';
    }

    function fontSize(el) {
        return parseFloat(window.getComputedStyle(el).fontSize) || 0;
    }

    function radiusOf(el) {
        return window.getComputedStyle(el).borderTopLeftRadius || '';
    }

    function cssUrl(url) {
        return String(url).replace(/["\\]/g, '\\$&');
    }

    /** 取卡片上某一段文字；卡片上没有这一段（0 张的相册）时给空串 */
    function text(root, sel) {
        var el = root ? root.querySelector(sel) : null;

        return el ? el.textContent : '';
    }

    /**
     * 动效时长由 CSS 的 --aw-dur 决定，这样 prefers-reduced-motion 只要在
     * 样式表里把它压到 1ms，这边就整体跟着变成"瞬间完成"。
     *
     * 下限卡在 1 而不是 0：0 会让"动画结束了"这件事变得没有可靠的判定点。
     */
    function readMs(prop, fallback) {
        var value = parseFloat(window.getComputedStyle(S.app).getPropertyValue(prop));

        return isNaN(value) ? fallback : Math.max(value, 1);
    }

    function readDur() {
        return readMs('--aw-dur', DEFAULTS.dur);
    }

    function readEase() {
        var value = window.getComputedStyle(S.app).getPropertyValue('--aw-ease');

        return value && value.trim() ? value.trim() : DEFAULTS.ease;
    }

    function lockScroll() {
        var root = document.documentElement;
        var gap = window.innerWidth - root.clientWidth;

        S.lockedOverflow = root.style.overflow;
        S.lockedPadding = document.body.style.paddingRight;
        root.style.overflow = 'hidden';

        // 补上滚动条让出来的宽度，否则整页会往右跳一下
        if (gap > 0) {
            document.body.style.paddingRight =
                'calc(' + (S.lockedPadding || '0px') + ' + ' + gap + 'px)';
        }
    }

    function unlockScroll() {
        document.documentElement.style.overflow = S.lockedOverflow || '';
        document.body.style.paddingRight = S.lockedPadding || '';
        S.lockedOverflow = '';
        S.lockedPadding = '';
    }

    // ────────────────────────────────────────────────────────
    // 全局监听（整份脚本只装一次）
    // ────────────────────────────────────────────────────────

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') {
            return;
        }

        // 一层一层退：照片开着就关照片，没开才轮到相册
        if (V.open) {
            if (!V.busy) {
                requestClosePhoto();
            }
            return;
        }

        if (S.openCard && !S.busy) {
            requestClose();
        }
    });

    window.addEventListener('popstate', onPopState);

    // 改窗口宽度会改掉滚动条的形态（比如内容不再溢出），槽宽得重新量；
    // 面板宽度变了，照片墙放得下几列也可能跟着变。
    // 只在相册开着的时候有意义，关着的时候详情是 display:none，量不到。
    window.addEventListener('resize', function () {
        if (S.openCard) {
            syncGutter();
            layoutWall();
        }

        // 框的大小是照着视口算的，转屏之后要重排
        refitPhoto();
    });

    window.addEventListener('pjax:complete', function () {
        // 已经不在相册页了，把残留的浮层和滚动锁收干净
        if (!document.querySelector('.aw-app')) {
            dropOrphans();
            return;
        }

        init();
    });

    window.AlbumWall = { init: init };
})();
