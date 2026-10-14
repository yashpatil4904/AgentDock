<?php
/**
 * Plugin Name: AgentDock storefront
 * Description: Layout and color for the Storefront theme.
 */

add_action("init", function () {
    if (get_option("agentdock_look_version") === "2") {
        return;
    }
    $colors = [
        "storefront_header_background_color" => "#ffffff",
        "storefront_header_text_color" => "#1c1917",
        "storefront_header_link_color" => "#44403c",
        "storefront_footer_background_color" => "#ffffff",
        "storefront_footer_text_color" => "#57534e",
        "storefront_footer_heading_color" => "#1c1917",
        "storefront_footer_link_color" => "#1c1917",
        "storefront_button_background_color" => "#c45c26",
        "storefront_button_text_color" => "#ffffff",
        "storefront_button_alt_background_color" => "#1c1917",
        "storefront_button_alt_text_color" => "#ffffff",
        "storefront_text_color" => "#44403c",
        "storefront_heading_color" => "#1c1917",
        "storefront_accent_color" => "#c45c26",
        "background_color" => "f6f4f1",
    ];
    foreach ($colors as $key => $value) {
        set_theme_mod($key, $value);
    }
    update_option("blogdescription", "Free delivery. Pay when it arrives.");
    if (function_exists("wc_get_page_id")) {
        $shop = (int) wc_get_page_id("shop");
        if ($shop > 0) {
            update_option("show_on_front", "page");
            update_option("page_on_front", $shop);
        }
    }
    update_option("agentdock_look_version", "2");
});

add_filter("wp_list_pages_excludes", function ($ids) {
    foreach (["sample-page", "cart", "checkout", "my-account", "shop"] as $slug) {
        $page = get_page_by_path($slug);
        if ($page instanceof WP_Post) {
            $ids[] = (int) $page->ID;
        }
    }
    return $ids;
});

add_filter("wp_page_menu_args", function ($args) {
    $args["show_home"] = false;
    return $args;
});

add_action("wp", function () {
    remove_action("woocommerce_after_shop_loop", "woocommerce_catalog_ordering", 10);
    remove_action("woocommerce_after_shop_loop", "woocommerce_result_count", 20);
});

add_filter("woocommerce_show_page_title", function () {
    return false;
});

add_filter("loop_shop_columns", function () {
    return 3;
});

add_action("wp_head", function () {
    if (is_admin()) {
        return;
    }
    echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560&amp;family=Outfit:wght@400;500;600&amp;display=swap">';
    echo "<style id=\"agentdock-look\">\n" . agentdock_look_css() . "\n</style>\n";
}, 99);

add_action("storefront_before_content", function () {
    if (!is_front_page() && !(function_exists("is_shop") && is_shop())) {
        return;
    }
    $name = get_bloginfo("name");
    echo '<section class="agentdock-hero"><div class="agentdock-hero-inner">';
    echo "<div><p class=\"agentdock-kicker\">Catalog</p><h1>" . esc_html($name) . "</h1></div>";
    echo "<p>Free delivery. Pay when the order arrives.</p>";
    echo "</div></section>";
}, 15);

function agentdock_look_css(): string
{
    return <<<'CSS'
body.theme-storefront {
  background: #f6f4f1;
  color: #44403c;
  font-family: Outfit, "Source Sans Pro", sans-serif;
}
body.theme-storefront h1,
body.theme-storefront h2,
body.theme-storefront h3,
.site-header .site-title {
  font-family: Fraunces, Georgia, serif;
  letter-spacing: -0.03em;
  color: #1c1917;
}
.col-full {
  max-width: 1120px;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
  padding-left: 24px;
  padding-right: 24px;
  float: none;
  box-sizing: border-box;
}
.site-header,
.home.blog .site-header,
.home.page .site-header,
.home.post-type-archive-product .site-header,
.no-wc-breadcrumb .site-header {
  margin-bottom: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  color: #1c1917 !important;
  border-bottom: 1px solid #e7e2da !important;
  box-shadow: none;
}
.site-header .col-full::before,
.site-header .col-full::after,
.woocommerce ul.products::before,
.woocommerce ul.products::after {
  content: none !important;
  display: none !important;
}
.site-header .site-description,
.site-header .main-navigation,
.handheld-navigation {
  display: none !important;
}
.site-header .site-branding,
.site-header .site-search,
.site-header .main-navigation,
.site-header .site-header-cart,
.woocommerce-active .site-header .site-branding,
.woocommerce-active .site-header .site-search,
.woocommerce-active .site-header .main-navigation,
.woocommerce-active .site-header .site-header-cart {
  float: none !important;
  width: auto !important;
  margin: 0 !important;
  clear: none !important;
}
@media (min-width: 768px) {
  .site-header > .col-full,
  .storefront-primary-navigation,
  .storefront-primary-navigation > .col-full {
    display: contents;
  }
  .site-header {
    display: flex !important;
    width: 100% !important;
    align-items: center;
    gap: 28px;
    min-height: 76px;
    max-width: none !important;
    margin: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    padding-left: max(24px, calc((100% - 1120px) / 2)) !important;
    padding-right: max(24px, calc((100% - 1120px) / 2)) !important;
    box-sizing: border-box;
  }
  .site-header .menu-toggle { display: none !important; }
  .site-header .site-branding { order: 1; }
  .site-header .main-navigation { order: 2; }
  .woocommerce-active .site-header .site-search { order: 3; margin-left: auto !important; }
  .site-header .site-header-cart { order: 4; }
}
.site-header .site-title {
  margin: 0;
  font-size: 1.55rem;
  line-height: 1;
}
.site-header .site-title a,
.site-header .main-navigation ul li a,
.site-header .site-header-cart a {
  color: #1c1917 !important;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  font-size: 0.95rem;
}
.site-header .main-navigation ul li a {
  font-family: Outfit, "Source Sans Pro", sans-serif;
  padding: 8px 0;
}
.site-header .main-navigation ul.menu,
.site-header .main-navigation ul {
  display: flex;
  align-items: center;
  gap: 22px;
  margin: 0;
}
.site-header .site-search form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.site-header .search-field {
  width: 220px;
  height: 40px;
  margin: 0;
  padding: 0 14px;
  border: 1px solid #e7e2da;
  border-radius: 999px;
  background: #f6f4f1;
  box-shadow: none;
}
.site-header .site-search button {
  height: 40px;
  margin: 0;
  padding: 0 14px !important;
}
.site-header-cart .cart-contents {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.agentdock-hero {
  background: transparent;
  color: #44403c;
}
.agentdock-hero-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 24px 0;
  box-sizing: border-box;
}
.agentdock-kicker {
  margin: 0 0 4px;
  color: #c45c26;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.agentdock-hero h1 {
  margin: 0;
  font-size: 2rem;
  line-height: 1.1;
}
.agentdock-hero p:last-child {
  margin: 8px 0 0;
  color: #78716c;
  font-size: 0.95rem;
}
.main-navigation:not(:has(li)) {
  display: none !important;
}
.storefront-sorting {
  display: flex;
  align-items: center;
  gap: 16px;
  float: none;
  margin: 4px 0 16px !important;
}
.woocommerce-ordering,
.woocommerce-result-count {
  float: none !important;
  margin: 0 !important;
}
.woocommerce-ordering select {
  height: 40px;
  border: 1px solid #e7e2da;
  border-radius: 999px;
  background: #fff;
  padding: 0 32px 0 14px;
}
.site-content {
  padding-top: 12px;
}
.woocommerce-breadcrumb,
#secondary,
.widget-area {
  display: none;
}
.site-content .content-area,
.woocommerce-products-header {
  width: 100% !important;
  float: none !important;
  margin: 0 !important;
}
.woocommerce ul.products {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin: 8px 0 0 !important;
  padding: 0;
}
.woocommerce ul.products li.product {
  width: auto !important;
  margin: 0 !important;
  float: none !important;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e7e2da;
  border-radius: 16px;
  padding: 12px;
  box-shadow: none;
}
.woocommerce ul.products li.product img {
  width: 100%;
  height: 220px;
  object-fit: cover;
  border-radius: 12px;
  background: #f3efe9;
  margin: 0 0 12px;
}
.woocommerce ul.products li.product,
.woocommerce ul.products li.product .woocommerce-loop-product__title,
.woocommerce ul.products li.product .price {
  text-align: left;
}
.woocommerce ul.products li.product .woocommerce-loop-product__title,
.woocommerce ul.products li.product .woocommerce-loop-category__title {
  font-family: Fraunces, Georgia, serif;
  font-size: 1.15rem;
  padding: 0 4px !important;
  color: #1c1917;
}
.woocommerce ul.products li.product .price {
  color: #c45c26;
  font-weight: 600;
  padding: 0 4px;
  margin-bottom: 12px;
}
.woocommerce ul.products li.product .button {
  margin-top: auto;
  align-self: flex-start;
}
.woocommerce a.button,
.woocommerce button.button,
.woocommerce input.button,
.button,
button,
input[type="submit"] {
  border-radius: 999px !important;
  font-family: Outfit, "Source Sans Pro", sans-serif;
}
.woocommerce span.onsale {
  background: #1c1917;
  border-radius: 999px;
}
.woocommerce div.product {
  background: #fff;
  border: 1px solid #e7e2da;
  border-radius: 16px;
  padding: 24px;
}
.site-footer {
  margin-top: 48px;
  background: #fff !important;
  color: #57534e !important;
  border-top: 1px solid #e7e2da;
}
.site-footer a,
.site-footer h2,
.site-footer .widget-title {
  color: #1c1917 !important;
}
.storefront-handheld-footer-bar {
  background: #fff;
  border-top: 1px solid #e7e2da;
}
@media (max-width: 767px) {
  .site-header > .col-full {
    display: block;
    padding-top: 16px;
    padding-bottom: 12px;
  }
  .site-header .site-search,
  .site-header .search-field {
    width: 100% !important;
  }
  .site-header .site-search form {
    margin-top: 12px;
  }
  .agentdock-hero-inner,
  .woocommerce ul.products {
    display: block;
  }
  .woocommerce ul.products {
    display: grid !important;
    grid-template-columns: 1fr;
  }
  .agentdock-hero h1 {
    font-size: 1.7rem;
  }
  .agentdock-hero p:last-child {
    margin-top: 8px;
  }
}
CSS;
}
