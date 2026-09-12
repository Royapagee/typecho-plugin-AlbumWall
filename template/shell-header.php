<?php
/**
 * 兜底外壳的头部。
 *
 * 只在主题既没有 header.php 也没有 template-parts/header.php 时才会被 require——
 * 也就是说这页拿不到主题的样式，所以这里自己带一点最小骨架，保证页面还能看。
 */

if (!defined('__TYPECHO_ROOT_DIR__')) {
    exit;
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo \TypechoPlugin\AlbumWall\View::escape(\TypechoPlugin\AlbumWall\View::title()); ?></title>
</head>
<body>
<div class="aw-container">
