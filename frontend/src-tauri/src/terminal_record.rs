use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Starting,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

/// Fields owned by native cleanup are typed; other backend fields survive round trips.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecord {
    #[serde(rename = "ownerID")]
    pub owner_id: String,
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "backendPID"
    )]
    pub backend_pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl std::fmt::Display for TerminalRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = serde_json::to_string(self).map_err(|_| std::fmt::Error)?;
        f.write_str(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backend_record_roundtrip_preserves_unowned_fields() {
        let raw = include_str!("../../../config/contracts/terminal-record.json");
        let original: Value = serde_json::from_str(raw).unwrap();
        let mut record: TerminalRecord = serde_json::from_str(raw).unwrap();
        assert!(record.status == Status::Completed);
        assert_eq!(record.backend_pid, Some(23456));
        record.status = Status::Interrupted;
        let saved = serde_json::to_value(record).unwrap();
        for key in ["id", "sessionID", "segments", "futureField", "pid"] {
            assert_eq!(saved[key], original[key]);
        }
        assert_eq!(saved["status"], "interrupted");
    }
}
