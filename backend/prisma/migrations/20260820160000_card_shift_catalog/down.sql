-- Rollback: card_shift_catalog.
--
-- Silme, PARASI ÖDENMİŞ hiçbir satıra dokunamaz: TenantAddOn.addOnId
-- onDelete: Restrict, yani sahiplenilmiş bir katalog satırını silmek ya hata
-- verir ya da ödenmiş bir yetkiyi öksüz bırakır. NOT EXISTS guard'ı olmadan bu
-- rollback bir müşterinin ₺4.000'ını yok edebilir. Aynı mantık donanımda sipariş
-- kalemi için geçerlidir.
-- Idempotent: ikinci çalıştırma hiçbir satır bulmaz.

DELETE FROM "marketplace_addons" m
 WHERE m."code" = 'module_personnel_card_shift'
   AND NOT EXISTS (SELECT 1 FROM "tenant_addons" ta WHERE ta."addOnId" = m."id");

-- Sipariş edilmemiş SKU'nun stok satırı ve kendisi gider; sipariş görmüşse kalır.
DELETE FROM "hardware_inventory" hi
 USING "hardware_products" hp
 WHERE hi."productId" = hp."id"
   AND hp."sku" = 'card-reader-rfid-usb-hid'
   AND hi."allocated" = 0 AND hi."shipped" = 0
   AND NOT EXISTS (SELECT 1 FROM "hardware_order_items" oi WHERE oi."productId" = hp."id");

DELETE FROM "hardware_products" hp
 WHERE hp."sku" = 'card-reader-rfid-usb-hid'
   AND NOT EXISTS (SELECT 1 FROM "hardware_order_items" oi WHERE oi."productId" = hp."id")
   AND NOT EXISTS (SELECT 1 FROM "hardware_inventory" hi WHERE hi."productId" = hp."id");
