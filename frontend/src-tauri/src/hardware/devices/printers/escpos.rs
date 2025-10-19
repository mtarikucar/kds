use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::traits::{
    HardwareDevice, PrinterDevice, DeviceStatus, DeviceType,
    ConnectionStatus, HealthStatus, ReceiptData, KitchenOrderData,
    TextAlignment, TextStyle, PaperStatus, BarcodeType,
};
use crate::hardware::connections::Connection;

/// ESC/POS compatible thermal printer
pub struct EscPosPrinter {
    id: String,
    name: String,
    connection: Arc<Mutex<Box<dyn Connection>>>,
    last_activity: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
}

impl EscPosPrinter {
    pub fn new(
        id: String,
        name: String,
        connection: Box<dyn Connection>,
    ) -> Self {
        Self {
            id,
            name,
            connection: Arc::new(Mutex::new(connection)),
            last_activity: Arc::new(Mutex::new(None)),
        }
    }

    async fn send_command(&self, command: &[u8]) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.send(command).await?;
        *self.last_activity.lock().await = Some(chrono::Utc::now());
        Ok(())
    }

    // ESC/POS Commands
    fn cmd_init() -> &'static [u8] { &[0x1B, 0x40] }
    fn cmd_cut_full() -> &'static [u8] { &[0x1D, 0x56, 0x00] }
    fn cmd_cut_partial() -> &'static [u8] { &[0x1D, 0x56, 0x01] }
    fn cmd_align_left() -> &'static [u8] { &[0x1B, 0x61, 0x00] }
    fn cmd_align_center() -> &'static [u8] { &[0x1B, 0x61, 0x01] }
    fn cmd_align_right() -> &'static [u8] { &[0x1B, 0x61, 0x02] }
    fn cmd_bold_on() -> &'static [u8] { &[0x1B, 0x45, 0x01] }
    fn cmd_bold_off() -> &'static [u8] { &[0x1B, 0x45, 0x00] }
    fn cmd_underline_on() -> &'static [u8] { &[0x1B, 0x2D, 0x01] }
    fn cmd_underline_off() -> &'static [u8] { &[0x1B, 0x2D, 0x00] }
    fn cmd_double_height() -> &'static [u8] { &[0x1B, 0x21, 0x10] }
    fn cmd_double_width() -> &'static [u8] { &[0x1B, 0x21, 0x20] }
    fn cmd_double_both() -> &'static [u8] { &[0x1B, 0x21, 0x30] }
    fn cmd_normal_size() -> &'static [u8] { &[0x1B, 0x21, 0x00] }
    fn cmd_open_drawer() -> &'static [u8] { &[0x1B, 0x70, 0x00, 0x19, 0xFA] }
    fn cmd_newline() -> &'static [u8] { &[0x0A] }

    async fn set_alignment(&self, alignment: TextAlignment) -> HardwareResult<()> {
        let cmd = match alignment {
            TextAlignment::Left => Self::cmd_align_left(),
            TextAlignment::Center => Self::cmd_align_center(),
            TextAlignment::Right => Self::cmd_align_right(),
        };
        self.send_command(cmd).await
    }

    async fn apply_style(&self, style: &TextStyle) -> HardwareResult<()> {
        if style.bold {
            self.send_command(Self::cmd_bold_on()).await?;
        }
        if style.underline {
            self.send_command(Self::cmd_underline_on()).await?;
        }
        if style.double_height && style.double_width {
            self.send_command(Self::cmd_double_both()).await?;
        } else if style.double_height {
            self.send_command(Self::cmd_double_height()).await?;
        } else if style.double_width {
            self.send_command(Self::cmd_double_width()).await?;
        }
        Ok(())
    }

    async fn clear_style(&self) -> HardwareResult<()> {
        self.send_command(Self::cmd_bold_off()).await?;
        self.send_command(Self::cmd_underline_off()).await?;
        self.send_command(Self::cmd_normal_size()).await?;
        Ok(())
    }
}

#[async_trait]
impl HardwareDevice for EscPosPrinter {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn device_type(&self) -> DeviceType {
        DeviceType::ThermalPrinter
    }

    async fn connect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.connect().await?;

        // Initialize printer
        conn.send(Self::cmd_init()).await?;

        tracing::info!("Printer {} connected", self.name);
        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.disconnect().await?;
        tracing::info!("Printer {} disconnected", self.name);
        Ok(())
    }

    fn is_connected(&self) -> bool {
        // Note: This is synchronous, so we can't await the lock
        // In a real implementation, you might want to store connection state separately
        true // Placeholder
    }

    async fn get_status(&self) -> HardwareResult<DeviceStatus> {
        let conn = self.connection.lock().await;
        let last_activity = *self.last_activity.lock().await;

        Ok(DeviceStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            device_type: DeviceType::ThermalPrinter,
            connection_status: if conn.is_connected() {
                ConnectionStatus::Connected
            } else {
                ConnectionStatus::Disconnected
            },
            health: HealthStatus::Healthy,
            last_activity,
            error_message: None,
        })
    }

    async fn health_check(&mut self) -> HardwareResult<HealthStatus> {
        // Send a simple command to check if printer responds
        // In real implementation, send DLE EOT command to get real-time status
        if self.is_connected() {
            Ok(HealthStatus::Healthy)
        } else {
            Ok(HealthStatus::Error)
        }
    }

    async fn reset(&mut self) -> HardwareResult<()> {
        self.send_command(Self::cmd_init()).await
    }

    fn capabilities(&self) -> serde_json::Value {
        serde_json::json!({
            "protocol": "ESC/POS",
            "features": [
                "receipt_printing",
                "kitchen_order_printing",
                "text_formatting",
                "paper_cutting",
                "cash_drawer_control",
                "barcode_printing",
                "qr_code_printing"
            ],
            "paper_width_mm": 80,
            "max_line_width": 48
        })
    }
}

#[async_trait]
impl PrinterDevice for EscPosPrinter {
    async fn print_receipt(&mut self, receipt: &ReceiptData) -> HardwareResult<()> {
        self.send_command(Self::cmd_init()).await?;

        // Header
        self.set_alignment(TextAlignment::Center).await?;
        self.apply_style(&TextStyle {
            bold: true,
            double_height: true,
            ..Default::default()
        }).await?;
        self.send_command(b"KDS RESTAURANT\n").await?;
        self.clear_style().await?;
        self.send_command(b"\n").await?;

        // Order Info
        self.set_alignment(TextAlignment::Left).await?;
        let order_line = format!("Order: #{}\n", receipt.order_id);
        self.send_command(order_line.as_bytes()).await?;

        if let Some(table) = &receipt.table_number {
            let table_line = format!("Table: {}\n", table);
            self.send_command(table_line.as_bytes()).await?;
        }

        let timestamp = receipt.timestamp.format("%Y-%m-%d %H:%M:%S").to_string();
        let time_line = format!("Time: {}\n", timestamp);
        self.send_command(time_line.as_bytes()).await?;

        self.send_command(b"--------------------------------\n").await?;

        // Items
        for item in &receipt.items {
            let line = format!(
                "{} x {}  ${:.2}\n",
                item.quantity, item.name, item.total_price
            );
            self.send_command(line.as_bytes()).await?;

            if let Some(modifiers) = &item.modifiers {
                for modifier in modifiers {
                    let mod_line = format!("  + {}\n", modifier);
                    self.send_command(mod_line.as_bytes()).await?;
                }
            }
        }

        self.send_command(b"--------------------------------\n").await?;

        // Totals
        let subtotal = format!("Subtotal:     ${:.2}\n", receipt.subtotal);
        self.send_command(subtotal.as_bytes()).await?;

        let tax = format!("Tax:          ${:.2}\n", receipt.tax);
        self.send_command(tax.as_bytes()).await?;

        self.apply_style(&TextStyle {
            bold: true,
            ..Default::default()
        }).await?;
        let total = format!("TOTAL:        ${:.2}\n", receipt.total);
        self.send_command(total.as_bytes()).await?;
        self.clear_style().await?;

        let payment = format!("Payment: {}\n", receipt.payment_method);
        self.send_command(payment.as_bytes()).await?;

        // Footer
        self.send_command(b"\n").await?;
        self.set_alignment(TextAlignment::Center).await?;
        self.send_command(b"Thank you!\n").await?;
        self.send_command(b"Visit us again\n").await?;
        self.send_command(b"\n\n\n").await?;

        // Cut paper
        self.cut_paper(false).await?;

        tracing::info!("Receipt printed for order {}", receipt.order_id);
        Ok(())
    }

    async fn print_kitchen_order(&mut self, order: &KitchenOrderData) -> HardwareResult<()> {
        self.send_command(Self::cmd_init()).await?;

        // Header
        self.set_alignment(TextAlignment::Center).await?;
        self.apply_style(&TextStyle {
            bold: true,
            double_height: true,
            double_width: true,
            ..Default::default()
        }).await?;
        self.send_command(b"KITCHEN ORDER\n").await?;
        self.clear_style().await?;
        self.send_command(b"\n").await?;

        // Order Info
        self.set_alignment(TextAlignment::Left).await?;
        self.apply_style(&TextStyle {
            bold: true,
            ..Default::default()
        }).await?;
        let order_line = format!("Order: #{}\n", order.order_id);
        self.send_command(order_line.as_bytes()).await?;

        if let Some(table) = &order.table_number {
            let table_line = format!("Table: {}\n", table);
            self.send_command(table_line.as_bytes()).await?;
        }

        let time = order.timestamp.format("%H:%M:%S").to_string();
        let time_line = format!("Time: {}\n", time);
        self.send_command(time_line.as_bytes()).await?;
        self.clear_style().await?;

        self.send_command(b"--------------------------------\n").await?;

        // Items
        for item in &order.items {
            self.apply_style(&TextStyle {
                bold: true,
                ..Default::default()
            }).await?;
            let line = format!("{} x {}\n", item.quantity, item.name);
            self.send_command(line.as_bytes()).await?;
            self.clear_style().await?;

            if let Some(modifiers) = &item.modifiers {
                for modifier in modifiers {
                    let mod_line = format!("  + {}\n", modifier);
                    self.send_command(mod_line.as_bytes()).await?;
                }
            }

            if let Some(instructions) = &item.cooking_instructions {
                let inst_line = format!("  NOTE: {}\n", instructions);
                self.send_command(inst_line.as_bytes()).await?;
            }

            self.send_command(b"\n").await?;
        }

        if let Some(special_instructions) = &order.special_instructions {
            self.send_command(b"SPECIAL INSTRUCTIONS:\n").await?;
            self.apply_style(&TextStyle {
                bold: true,
                ..Default::default()
            }).await?;
            let inst_line = format!("{}\n", special_instructions);
            self.send_command(inst_line.as_bytes()).await?;
            self.clear_style().await?;
        }

        self.send_command(b"\n\n\n").await?;
        self.cut_paper(false).await?;

        tracing::info!("Kitchen order printed for order {}", order.order_id);
        Ok(())
    }

    async fn print_text(
        &mut self,
        text: &str,
        alignment: TextAlignment,
        style: TextStyle,
    ) -> HardwareResult<()> {
        self.set_alignment(alignment).await?;
        self.apply_style(&style).await?;
        self.send_command(text.as_bytes()).await?;
        self.clear_style().await?;
        Ok(())
    }

    async fn print_line(&mut self, character: char, length: usize) -> HardwareResult<()> {
        let line: String = character.to_string().repeat(length);
        self.send_command(line.as_bytes()).await?;
        self.send_command(Self::cmd_newline()).await?;
        Ok(())
    }

    async fn feed_paper(&mut self, lines: u8) -> HardwareResult<()> {
        for _ in 0..lines {
            self.send_command(Self::cmd_newline()).await?;
        }
        Ok(())
    }

    async fn cut_paper(&mut self, partial: bool) -> HardwareResult<()> {
        let cmd = if partial {
            Self::cmd_cut_partial()
        } else {
            Self::cmd_cut_full()
        };
        self.send_command(cmd).await
    }

    async fn open_cash_drawer(&mut self) -> HardwareResult<()> {
        self.send_command(Self::cmd_open_drawer()).await?;
        tracing::info!("Cash drawer opened via printer {}", self.name);
        Ok(())
    }

    async fn check_paper_status(&mut self) -> HardwareResult<PaperStatus> {
        // In real implementation, send DLE EOT 4 command and read response
        // For now, return unknown
        Ok(PaperStatus::Unknown)
    }

    async fn print_barcode(&mut self, data: &str, barcode_type: BarcodeType) -> HardwareResult<()> {
        let barcode_id = match barcode_type {
            BarcodeType::Code39 => 4,
            BarcodeType::Code128 => 73,
            BarcodeType::Ean13 => 67,
            BarcodeType::Ean8 => 68,
            BarcodeType::Upca => 65,
            BarcodeType::Upce => 66,
        };

        // Set barcode height
        self.send_command(&[0x1D, 0x68, 100]).await?;
        // Set barcode width
        self.send_command(&[0x1D, 0x77, 2]).await?;
        // Print barcode
        let mut cmd = vec![0x1D, 0x6B, barcode_id, data.len() as u8];
        cmd.extend_from_slice(data.as_bytes());
        self.send_command(&cmd).await?;
        self.send_command(Self::cmd_newline()).await?;

        Ok(())
    }

    async fn print_qr_code(&mut self, data: &str, size: u8) -> HardwareResult<()> {
        // QR Code Model
        self.send_command(&[0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]).await?;

        // QR Code Size
        self.send_command(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size]).await?;

        // QR Code Data
        let len = data.len() + 3;
        let pl = (len % 256) as u8;
        let ph = (len / 256) as u8;
        let mut cmd = vec![0x1D, 0x28, 0x6B, pl, ph, 0x31, 0x50, 0x30];
        cmd.extend_from_slice(data.as_bytes());
        self.send_command(&cmd).await?;

        // Print QR Code
        self.send_command(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]).await?;
        self.send_command(Self::cmd_newline()).await?;

        Ok(())
    }
}
