<?php
/**
 * Idempotent store setup. WooCommerce hashes consumer keys with HMAC-SHA256
 * and the key "wc-api", so the plaintext key in the Kubernetes Secret is not
 * what gets stored in wp_woocommerce_api_keys.
 */

global $wpdb;

update_option("woocommerce_coming_soon", "no");
update_option("woocommerce_store_pages_only", "no");
update_option("woocommerce_onboarding_profile", ["skipped" => true, "completed" => true]);
update_option("woocommerce_currency", "USD");
update_option("woocommerce_default_country", "US:CA");
update_option("woocommerce_store_address", "1 Market Street");
update_option("woocommerce_store_city", "San Francisco");
update_option("woocommerce_store_postcode", "94105");
update_option("woocommerce_enable_guest_checkout", "yes");
update_option("woocommerce_enable_signup_and_login_from_checkout", "no");
update_option("woocommerce_cod_settings", [
    "enabled" => "yes",
    "title" => "Cash on delivery",
    "description" => "Pay with cash when your order is delivered.",
    "instructions" => "Pay with cash upon delivery.",
    "enable_for_methods" => "",
    "enable_for_virtual" => "yes",
]);

if (class_exists("WC_Install")) {
    WC_Install::create_pages();
}

if (class_exists("WC_Shipping_Zone")) {
    $zone = new WC_Shipping_Zone(0);
    $has_flat = false;
    foreach ($zone->get_shipping_methods() as $method) {
        if ($method->id === "flat_rate") {
            $has_flat = true;
        }
    }
    if (!$has_flat) {
        $instance_id = $zone->add_shipping_method("flat_rate");
        update_option("woocommerce_flat_rate_{$instance_id}_settings", [
            "title" => "Flat rate",
            "tax_status" => "none",
            "cost" => "0",
        ]);
    }
}

$key = getenv("WC_CONSUMER_KEY");
$secret = getenv("WC_CONSUMER_SECRET");
if (!$key || !$secret) {
    fwrite(STDERR, "WC_CONSUMER_KEY and WC_CONSUMER_SECRET are required\n");
    exit(1);
}

$table = $wpdb->prefix . "woocommerce_api_keys";
$existing = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$table} WHERE description = %s", "agentdock"));
if (!$existing) {
    $inserted = $wpdb->insert($table, [
        "user_id" => 1,
        "description" => "agentdock",
        "permissions" => "read_write",
        "consumer_key" => hash_hmac("sha256", $key, "wc-api"),
        "consumer_secret" => $secret,
        "truncated_key" => substr($key, -7),
    ]);
    if (!$inserted) {
        fwrite(STDERR, "failed to insert API key: {$wpdb->last_error}\n");
        exit(1);
    }
    echo "inserted WooCommerce API key\n";
} else {
    echo "WooCommerce API key already present\n";
}

if (function_exists("wc_get_product_id_by_sku") && !wc_get_product_id_by_sku("classic-tee")) {
    $product_id = wp_insert_post([
        "post_title" => "Classic Tee",
        "post_content" => "A sample product so checkout works before the chat agent creates another.",
        "post_status" => "publish",
        "post_type" => "product",
    ]);
    if (is_wp_error($product_id)) {
        fwrite(STDERR, $product_id->get_error_message() . "\n");
        exit(1);
    }
    wp_set_object_terms($product_id, "simple", "product_type");
    update_post_meta($product_id, "_regular_price", "19.00");
    update_post_meta($product_id, "_price", "19.00");
    update_post_meta($product_id, "_sku", "classic-tee");
    update_post_meta($product_id, "_stock_status", "instock");
    update_post_meta($product_id, "_manage_stock", "no");
    update_post_meta($product_id, "_virtual", "no");
    echo "created Classic Tee {$product_id}\n";
}
