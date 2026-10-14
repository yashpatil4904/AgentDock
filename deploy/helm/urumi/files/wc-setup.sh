#!/bin/bash
set -euo pipefail

echo "waiting for WordPress files"
for _ in $(seq 1 60); do
  if [ -f /var/www/html/wp-config.php ]; then
    break
  fi
  sleep 5
done
if [ ! -f /var/www/html/wp-config.php ]; then
  echo "wp-config.php was not created by the WordPress container" >&2
  exit 1
fi

echo "waiting for the database"
ready=0
for _ in $(seq 1 60); do
  if wp db check --path=/var/www/html --allow-root; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  echo "database did not become ready" >&2
  exit 1
fi

if ! wp core is-installed --path=/var/www/html --allow-root; then
  wp core install \
    --path=/var/www/html \
    --allow-root \
    --url="$WORDPRESS_URL" \
    --title="$WORDPRESS_TITLE" \
    --admin_user="$WORDPRESS_ADMIN_USER" \
    --admin_password="$WORDPRESS_ADMIN_PASSWORD" \
    --admin_email="$WORDPRESS_ADMIN_EMAIL" \
    --skip-email
fi

wp option update siteurl "$WORDPRESS_URL" --path=/var/www/html --allow-root
wp option update home "$WORDPRESS_URL" --path=/var/www/html --allow-root
wp option update blogname "$WORDPRESS_TITLE" --path=/var/www/html --allow-root

# Current WooCommerce releases require WordPress 7. An existing volume may
# still have the 6.8 files copied on first boot, so upgrade core before the plugin.
wp core update --path=/var/www/html --allow-root

if ! wp plugin is-installed woocommerce --path=/var/www/html --allow-root; then
  wp plugin install woocommerce --activate --path=/var/www/html --allow-root
else
  wp plugin activate woocommerce --path=/var/www/html --allow-root
fi

wp theme install storefront --activate --path=/var/www/html --allow-root || echo "storefront theme skipped"
wp rewrite structure '/%postname%/' --hard --path=/var/www/html --allow-root
wp eval-file /scripts/wc-setup.php --path=/var/www/html --allow-root
wp rewrite flush --hard --path=/var/www/html --allow-root

if ! grep -q "HTTP_AUTHORIZATION" /var/www/html/.htaccess 2>/dev/null; then
  printf '\nRewriteCond %%{HTTP:Authorization} .\nRewriteRule .* - [E=HTTP_AUTHORIZATION:%%{HTTP:Authorization}]\n' >> /var/www/html/.htaccess
fi

mkdir -p /var/www/html/wp-content/mu-plugins
if [ -f /scripts/agentdock-look.php ]; then
  cp /scripts/agentdock-look.php /var/www/html/wp-content/mu-plugins/agentdock-look.php
fi

chown -R 33:33 /var/www/html
echo "woocommerce bootstrap complete"
