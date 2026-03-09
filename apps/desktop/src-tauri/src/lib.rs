const ENCRYPTION_SERVICE_NAME: &str = "River Journal";

#[tauri::command]
async fn set_encryption_key(user_id: String, key_hex: String) -> Result<(), String> {
  log::info!("set_encryption_key start user_id={}", user_id);
  tauri::async_runtime::spawn_blocking(move || {
    let entry =
      keyring::Entry::new(ENCRYPTION_SERVICE_NAME, &format!("river-journal:e2e:{user_id}"))
        .map_err(|error| error.to_string())?;

    entry
      .set_password(&key_hex)
      .map_err(|error| error.to_string())
  })
  .await
  .map_err(|error| error.to_string())
  .and_then(|result| result)
  .map(|value| {
    log::info!("set_encryption_key success");
    value
  })
  .map_err(|error| {
    log::error!("set_encryption_key failed: {}", error);
    error
  })
}

#[tauri::command]
async fn get_encryption_key(user_id: String) -> Result<Option<String>, String> {
  log::info!("get_encryption_key start user_id={}", user_id);
  tauri::async_runtime::spawn_blocking(move || {
    let entry =
      keyring::Entry::new(ENCRYPTION_SERVICE_NAME, &format!("river-journal:e2e:{user_id}"))
        .map_err(|error| error.to_string())?;

    match entry.get_password() {
      Ok(value) => Ok(Some(value)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(error) => Err(error.to_string()),
    }
  })
  .await
  .map_err(|error| error.to_string())
  .and_then(|result| result)
  .map(|value| {
    log::info!(
      "get_encryption_key success found={}",
      if value.is_some() { "true" } else { "false" }
    );
    value
  })
  .map_err(|error| {
    log::error!("get_encryption_key failed: {}", error);
    error
  })
}

#[tauri::command]
async fn delete_encryption_key(user_id: String) -> Result<(), String> {
  log::info!("delete_encryption_key start user_id={}", user_id);
  tauri::async_runtime::spawn_blocking(move || {
    let entry =
      keyring::Entry::new(ENCRYPTION_SERVICE_NAME, &format!("river-journal:e2e:{user_id}"))
        .map_err(|error| error.to_string())?;

    match entry.delete_credential() {
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
      Err(error) => Err(error.to_string()),
    }
  })
  .await
  .map_err(|error| error.to_string())
  .and_then(|result| result)
  .map(|value| {
    log::info!("delete_encryption_key success");
    value
  })
  .map_err(|error| {
    log::error!("delete_encryption_key failed: {}", error);
    error
  })
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
