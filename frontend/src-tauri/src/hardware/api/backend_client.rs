use reqwest::Client;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::config::{HardwareConfig, DeviceConfig};

/// Client for fetching hardware configuration from backend API
pub struct BackendClient {
    client: Client,
    base_url: String,
}

impl BackendClient {
    pub fn new(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    /// Fetch hardware configuration from backend
    pub async fn fetch_hardware_config(&self) -> HardwareResult<HardwareConfig> {
        let url = format!("{}/api/hardware/config", self.base_url);

        tracing::info!("Fetching hardware config from: {}", url);

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| HardwareError::HttpError(e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(HardwareError::Unknown(
                format!("HTTP {}: {}", status, text)
            ));
        }

        let config: HardwareConfig = response
            .json()
            .await
            .map_err(|e| HardwareError::HttpError(e))?;

        tracing::info!(
            "Successfully fetched hardware config with {} devices",
            config.devices.len()
        );

        Ok(config)
    }

    /// Fetch configuration for a specific device
    pub async fn fetch_device_config(&self, device_id: &str) -> HardwareResult<DeviceConfig> {
        let url = format!("{}/api/hardware/devices/{}", self.base_url, device_id);

        tracing::info!("Fetching device config from: {}", url);

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| HardwareError::HttpError(e))?;

        if !response.status().is_success() {
            return Err(HardwareError::DeviceNotFound(device_id.to_string()));
        }

        let config: DeviceConfig = response
            .json()
            .await
            .map_err(|e| HardwareError::HttpError(e))?;

        Ok(config)
    }

    /// Update device status on backend
    pub async fn update_device_status(
        &self,
        device_id: &str,
        status: &serde_json::Value,
    ) -> HardwareResult<()> {
        let url = format!("{}/api/hardware/devices/{}/status", self.base_url, device_id);

        tracing::debug!("Updating device status for {}", device_id);

        let response = self.client
            .post(&url)
            .json(status)
            .send()
            .await
            .map_err(|e| HardwareError::HttpError(e))?;

        if !response.status().is_success() {
            tracing::warn!(
                "Failed to update device status: HTTP {}",
                response.status()
            );
        }

        Ok(())
    }

    /// Report device event to backend
    pub async fn report_device_event(
        &self,
        device_id: &str,
        event_type: &str,
        event_data: &serde_json::Value,
    ) -> HardwareResult<()> {
        let url = format!("{}/api/hardware/devices/{}/events", self.base_url, device_id);

        let payload = serde_json::json!({
            "event_type": event_type,
            "data": event_data,
            "timestamp": chrono::Utc::now(),
        });

        tracing::debug!("Reporting device event: {} for {}", event_type, device_id);

        let response = self.client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| HardwareError::HttpError(e))?;

        if !response.status().is_success() {
            tracing::warn!(
                "Failed to report device event: HTTP {}",
                response.status()
            );
        }

        Ok(())
    }

    /// Health check endpoint
    pub async fn health_check(&self) -> HardwareResult<bool> {
        let url = format!("{}/api/health", self.base_url);

        match self.client.get(&url).send().await {
            Ok(response) => Ok(response.status().is_success()),
            Err(_) => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_backend_client_creation() {
        let client = BackendClient::new("http://localhost:3000".to_string());
        assert_eq!(client.base_url, "http://localhost:3000");
    }
}
