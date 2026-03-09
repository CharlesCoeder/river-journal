const ENCRYPTION_SERVICE_NAME: &str = "River Journal";

#[tauri::command]
fn set_encryption_key(user_id: String, key_hex: String) -> Result<(), String> {
  let entry =
    keyring::Entry::new(ENCRYPTION_SERVICE_NAME, &format!("river-journal:e2e:{user_id}"))
      .map_err(|error| error.to_string())?;

  entry
    .set_password(&key_hex)
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_encryption_key(user_id: String) -> Result<Option<String>, String> {
  let entry =
    keyring::Entry::new(ENCRYPTION_SERVICE_NAME, &format!("river-journal:e2e:{user_id}"))
      .map_err(|error| error.to_string())?;

  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
fn delete_encryption_key(user_id: String) -> Result<(), String> {
  let entry =
    keyring::Entry::new(ENCRYPTION_SERVICE_NAME, &format!("river-journal:e2e:{user_id}"))
      .map_err(|error| error.to_string())?;

  match entry.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      set_encryption_key,
      get_encryption_key,
      delete_encryption_key
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
