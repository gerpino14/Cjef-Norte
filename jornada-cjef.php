<?php
/**
 * Plugin Name:       Jornada CJEF Norte
 * Plugin URI:        https://github.com/gerpino14/Cjef-Norte
 * Description:       Aplicación web para la gestión de credenciales, asistencia, almuerzos y administración de la Jornada CJEF. Insértala usando el shortcode [jornada_cjef].
 * Version:           1.0.0
 * Author:            Gerson
 * Author URI:        https://github.com/gerpino14
 * GitHub Plugin URI: gerpino14/Cjef-Norte
 * Primary Branch:    main
 */

if (!defined('ABSPATH')) {
    exit; // Evita el acceso directo
}

/**
 * Encolar scripts y estilos solo cuando se use el shortcode
 */
function jornada_cjef_enqueue_assets() {
    $plugin_url = plugin_dir_url(__FILE__);
    $version = '1.0.0';

    // Google Fonts
    wp_enqueue_style(
        'jornada-cjef-google-fonts',
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap',
        array(),
        null
    );

    // FontAwesome 6
    wp_enqueue_style(
        'jornada-cjef-fontawesome',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
        array(),
        '6.0.0'
    );

    // Estilos propios de la aplicación
    wp_enqueue_style(
        'jornada-cjef-app-style',
        $plugin_url . 'style.css',
        array(),
        $version
    );

    // Librerías JS externas requeridas
    wp_enqueue_script(
        'jornada-cjef-phosphor-icons',
        'https://unpkg.com/@phosphor-icons/web',
        array(),
        null,
        false
    );

    wp_enqueue_script(
        'jornada-cjef-qrcode',
        'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
        array(),
        '1.0.0',
        true
    );

    wp_enqueue_script(
        'jornada-cjef-html5-qrcode',
        'https://unpkg.com/html5-qrcode',
        array(),
        null,
        true
    );

    // Script de lógica cliente
    wp_enqueue_script(
        'jornada-cjef-app-logica',
        $plugin_url . 'logica.js',
        array('jornada-cjef-qrcode', 'jornada-cjef-html5-qrcode'),
        $version,
        true
    );
}

/**
 * Shortcode [jornada_cjef] (y alias [jornada_cjef_norte])
 */
function jornada_cjef_shortcode() {
    // Cargar estilos y scripts solo en la página que tiene el shortcode
    jornada_cjef_enqueue_assets();

    $html_file = plugin_dir_path(__FILE__) . 'app-template.php';
    if (!file_exists($html_file)) {
        $html_file = plugin_dir_path(__FILE__) . 'index.html';
    }

    ob_start();
    if (file_exists($html_file)) {
        $content = file_get_contents($html_file);
        
        // Si es el index.html completo, extraemos solo el interior del body para no duplicar etiquetas <html> y <head>
        if (preg_match('/<body[^>]*>(.*?)<\/body>/is', $content, $matches)) {
            $body_inner = $matches[1];
            // Quitar la inclusión de logica.js ya que se encola mediante wp_enqueue_script
            $body_inner = preg_replace('/<script[^>]*src=["\']logica\.js["\'][^>]*><\/script>/i', '', $body_inner);
            echo $body_inner;
        } else {
            echo $content;
        }
    } else {
        echo '<div style="color:red; padding:20px;">Error: No se encontró la plantilla de la aplicación.</div>';
    }
    return ob_get_clean();
}
add_shortcode('jornada_cjef', 'jornada_cjef_shortcode');
add_shortcode('jornada_cjef_norte', 'jornada_cjef_shortcode');
