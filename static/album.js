/*
 * AlbumWall —— 相册墙的展开动画
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

        openCard: null,
        pendingOpen: null,
        busy: false,
        timer: null,
        /** 落位后替身淡出的收尾定时器，和 timer 分开：它不该挡住任何操作 */
        fadeTimer: null,

        lockedOverflow: '',
        lockedPadding: ''
    };

    var DEFAULTS = { dur: 620, cross: 220, ease: 'cubic-bezier(.22,.9,.28,1)' };

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
            'body > .aw-scrim, body > .aw-shell, body > .aw-shell__title, body > .aw-shell__sub, body > .aw-detail'
        );

        for (var i = 0; i < orphans.length; i++) {
            orphans[i].remove();
        }

        // 上一页如果是在相册打开状态下被换掉的，滚动锁还挂着，这里一并还原
        unlockScroll();
        S.openCard = null;
        S.busy = false;
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

        bind(app);

        // 带 #album-数字 直接打开页面时，直接把那个相册展开
        var cid = albumFromHash();
        if (cid) {
            var card = cardFor(cid);
            if (card) {
                open(card, true);
            }
        }
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

        S.photos.textContent = '';

        var frag = document.createDocumentFragment();
        var photos = album.photos || [];

        for (var i = 0; i < photos.length; i++) {
            var figure = document.createElement('figure');
            figure.className = 'aw-photo';
            // 序号只递增到 11：41 张照片按每张 26ms 排下去最后一张要等一秒
            figure.style.setProperty('--aw-i', String(Math.min(i, 11)));

            var img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = photos[i];

            figure.appendChild(img);
            frag.appendChild(figure);
        }

        S.photos.appendChild(frag);
        S.empty.hidden = photos.length > 0;
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
     * 从 hash 里读当前应该展开哪个相册。
     *
     * 用 hash 而不是 history.state 是有意的：Jasmine 的 pjax 在滚动时会对
     * 当前历史记录做 replaceState({scrollY})，那会把我们写进去的 state 覆盖掉。
     * hash 不会被它碰，而且 Jasmine 的 onPopState 对纯 hash 变化是直接 return 的
     * （它自己也注释了"如果仅仅是 hash 变化，不执行 PJAX 加载"），正好不打架。
     */
    function albumFromHash() {
        var m = /^#album-(\d+)$/.exec(window.location.hash || '');
        return m ? m[1] : null;
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

    function onPopState() {
        var cid = albumFromHash();

        if (cid && (!S.openCard || S.openCard.getAttribute('data-cid') !== cid)) {
            var card = cardFor(cid);

            if (!card) {
                return;
            }

            if (S.openCard) {
                // 正在看另一个相册：等它关完再开这一个
                S.pendingOpen = cid;
                close();
            } else {
                open(card, true);
            }

            return;
        }

        if (!cid && S.openCard) {
            close();
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
        if (e.key === 'Escape' && S.openCard && !S.busy) {
            requestClose();
        }
    });

    window.addEventListener('popstate', onPopState);

    // 改窗口宽度会改掉滚动条的形态（比如内容不再溢出），槽宽得重新量。
    // 只在相册开着的时候有意义，关着的时候详情是 display:none，量不到。
    window.addEventListener('resize', function () {
        if (S.openCard) {
            syncGutter();
        }
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
