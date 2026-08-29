use crate::settings::{self, AppSettings, LLMPrompt, Theme, ThemeAccent};
use log::warn;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

const THEME_SCHEMA_VERSION: u32 = 1;
const CLASSIC_THEME_ID: &str = "classic";
const THEMES_DIR: &str = "themes";
const BUNDLED_THEMES_DIR: &str = "resources/themes";
const MAX_PACK_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PACK_FILES: usize = 512;
const MAX_PNG_DIMENSION: u32 = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeRenderer {
    Classic,
    ReactiveImage,
    Sprite,
    Particles,
    Web,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeOverlayAnchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ThemePointerMode {
    Passthrough,
    Interactive,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeOverlayManifest {
    pub renderer: ThemeRenderer,
    pub width: u32,
    pub height: u32,
    pub anchor: ThemeOverlayAnchor,
    pub pointer_mode: ThemePointerMode,
    #[serde(default)]
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct ThemePostProcessProfile {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemePostProcessingPreset {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<ThemePostProcessProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct ThemePreset {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Theme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<ThemeAccent>,
    #[serde(
        rename = "postProcessing",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub post_processing: Option<ThemePostProcessingPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemePackManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub preview: String,
    pub overlay: ThemeOverlayManifest,
    #[serde(default)]
    pub preset: ThemePreset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ThemePackSource {
    Classic,
    Bundled,
    Installed,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemePackInfo {
    pub manifest: ThemePackManifest,
    /// Absolute filesystem root. The frontend turns child paths into asset URLs.
    pub root: String,
    pub source: ThemePackSource,
    pub active: bool,
    pub code_theme: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayWindowConfig {
    pub width: u32,
    pub height: u32,
    pub anchor: ThemeOverlayAnchor,
    pub pointer_mode: ThemePointerMode,
}

fn classic_manifest() -> ThemePackManifest {
    ThemePackManifest {
        schema_version: THEME_SCHEMA_VERSION,
        id: CLASSIC_THEME_ID.to_string(),
        name: "Classic".to_string(),
        description: "LocalDictate's accessible compact overlay.".to_string(),
        author: "LocalDictate".to_string(),
        preview: String::new(),
        overlay: ThemeOverlayManifest {
            renderer: ThemeRenderer::Classic,
            width: 256,
            height: 46,
            anchor: ThemeOverlayAnchor::BottomCenter,
            pointer_mode: ThemePointerMode::Interactive,
            config: serde_json::json!({}),
        },
        preset: ThemePreset::default(),
    }
}

fn classic_info() -> ThemePackInfo {
    ThemePackInfo {
        manifest: classic_manifest(),
        root: String::new(),
        source: ThemePackSource::Classic,
        active: false,
        code_theme: false,
    }
}

fn installed_themes_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::portable::app_data_dir(app)
        .map(|path| path.join(THEMES_DIR))
        .map_err(|error| format!("failed to resolve the theme directory: {error}"))
}

fn bundled_themes_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(BUNDLED_THEMES_DIR, BaseDirectory::Resource)
        .map_err(|error| format!("failed to resolve bundled themes: {error}"))
}

fn manifest_root(source_path: &Path) -> Result<PathBuf, String> {
    let canonical = source_path
        .canonicalize()
        .map_err(|error| format!("theme source does not exist: {error}"))?;
    if canonical.is_dir() {
        Ok(canonical)
    } else if canonical.file_name().and_then(|name| name.to_str()) == Some("manifest.json") {
        canonical
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "theme manifest has no parent directory".to_string())
    } else {
        Err("select a theme directory or its manifest.json".to_string())
    }
}

fn validate_slug(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && !id.ends_with('-')
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.contains('\0') || value.contains('\\') || value.contains(':') {
        return Err(format!("unsafe asset path '{value}'"));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("unsafe asset path '{value}'"));
    }
    Ok(path.to_path_buf())
}

fn validate_asset(
    root: &Path,
    relative: &str,
    expected_extension: Option<&str>,
) -> Result<(), String> {
    let relative_path = safe_relative_path(relative)?;
    if let Some(expected) = expected_extension {
        let actual = relative_path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default();
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!("asset '{relative}' must be a .{expected} file"));
        }
    }
    let absolute = root.join(&relative_path);
    let metadata = fs::symlink_metadata(&absolute)
        .map_err(|_| format!("theme asset '{relative}' is missing"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("theme asset '{relative}' must be a regular file"));
    }
    Ok(())
}

fn png_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("failed to open PNG '{}': {error}", path.display()))?;
    let mut header = [0_u8; 24];
    file.read_exact(&mut header)
        .map_err(|_| format!("PNG '{}' has an invalid header", path.display()))?;
    if &header[..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" {
        return Err(format!("'{}' is not a valid PNG", path.display()));
    }
    let width = u32::from_be_bytes(header[16..20].try_into().map_err(|_| "invalid PNG width")?);
    let height = u32::from_be_bytes(
        header[20..24]
            .try_into()
            .map_err(|_| "invalid PNG height")?,
    );
    if width == 0 || height == 0 || width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION {
        return Err(format!(
            "PNG '{}' is {}x{}; dimensions must be 1..={}",
            path.display(),
            width,
            height,
            MAX_PNG_DIMENSION
        ));
    }
    Ok((width, height))
}

fn validate_wav(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("failed to open WAV '{}': {error}", path.display()))?;
    let mut header = [0_u8; 12];
    file.read_exact(&mut header)
        .map_err(|_| format!("WAV '{}' has an invalid header", path.display()))?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return Err(format!("'{}' is not a valid WAV", path.display()));
    }
    Ok(())
}

fn allowed_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "wav" | "json" | "js" | "css" | "glsl" | "vert" | "frag" | "txt")
    )
}

fn inspect_pack_tree(root: &Path) -> Result<(), String> {
    fn visit(
        root: &Path,
        directory: &Path,
        total: &mut u64,
        files: &mut usize,
    ) -> Result<(), String> {
        let entries = fs::read_dir(directory)
            .map_err(|error| format!("failed to read '{}': {error}", directory.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("failed to read theme entry: {error}"))?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("failed to inspect '{}': {error}", path.display()))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "theme packs cannot contain symlinks: '{}'",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                visit(root, &path, total, files)?;
            } else if metadata.is_file() {
                *files += 1;
                *total = total.saturating_add(metadata.len());
                let relative = path.strip_prefix(root).unwrap_or(&path);
                if *files > MAX_PACK_FILES {
                    return Err(format!(
                        "theme pack contains more than {MAX_PACK_FILES} files"
                    ));
                }
                if *total > MAX_PACK_BYTES {
                    return Err("theme pack exceeds the 25 MiB limit".to_string());
                }
                if !allowed_extension(&path) {
                    return Err(format!(
                        "unsupported theme file type: '{}'",
                        relative.display()
                    ));
                }
                match path.extension().and_then(|extension| extension.to_str()) {
                    Some(extension) if extension.eq_ignore_ascii_case("png") => {
                        png_dimensions(&path)?;
                    }
                    Some(extension) if extension.eq_ignore_ascii_case("wav") => {
                        validate_wav(&path)?;
                    }
                    _ => {}
                }
            } else {
                return Err(format!("unsupported theme entry: '{}'", path.display()));
            }
        }
        Ok(())
    }

    let mut total = 0;
    let mut files = 0;
    visit(root, root, &mut total, &mut files)
}

fn config_object<'a>(
    value: &'a serde_json::Value,
    context: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{context} must be an object"))
}

fn required_config_string<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    field: &str,
    context: &str,
) -> Result<&'a str, String> {
    object
        .get(field)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{context}.{field} must be a non-empty string"))
}

fn validate_renderer_config(root: &Path, overlay: &ThemeOverlayManifest) -> Result<(), String> {
    let config = config_object(&overlay.config, "overlay.config")?;
    match overlay.renderer {
        ThemeRenderer::Classic => {
            return Err("installed packs cannot use the reserved classic renderer".to_string());
        }
        ThemeRenderer::ReactiveImage => {
            let layers = config
                .get("layers")
                .and_then(serde_json::Value::as_array)
                .filter(|layers| !layers.is_empty())
                .ok_or_else(|| {
                    "reactive-image overlay.config.layers must be a non-empty array".to_string()
                })?;
            for (index, layer) in layers.iter().enumerate() {
                let context = format!("reactive-image layer {index}");
                let layer = config_object(layer, &context)?;
                let asset = required_config_string(layer, "asset", &context)?;
                validate_asset(root, asset, Some("png"))?;
            }
        }
        ThemeRenderer::Sprite => {
            let layers = config
                .get("layers")
                .and_then(serde_json::Value::as_array)
                .filter(|layers| !layers.is_empty())
                .ok_or_else(|| {
                    "sprite overlay.config.layers must be a non-empty array".to_string()
                })?;
            for (index, layer) in layers.iter().enumerate() {
                let context = format!("sprite layer {index}");
                let layer = config_object(layer, &context)?;
                let atlas = required_config_string(layer, "atlas", &context)?;
                validate_asset(root, atlas, Some("png"))?;
                for field in ["columns", "rows"] {
                    if layer.get(field).and_then(serde_json::Value::as_u64) == Some(0)
                        || layer
                            .get(field)
                            .and_then(serde_json::Value::as_u64)
                            .is_none()
                    {
                        return Err(format!("{context}.{field} must be a positive integer"));
                    }
                }
                let clips = layer
                    .get("clips")
                    .and_then(serde_json::Value::as_object)
                    .filter(|clips| !clips.is_empty());
                let lifecycle_clips = layer
                    .get("lifecycleClips")
                    .and_then(serde_json::Value::as_object);
                let (Some(clips), Some(lifecycle_clips)) = (clips, lifecycle_clips) else {
                    return Err(format!(
                        "{context} must define non-empty clips and lifecycleClips objects"
                    ));
                };
                for lifecycle in ["idle", "arming", "listening", "transcribing", "processing"] {
                    let clip = required_config_string(
                        lifecycle_clips,
                        lifecycle,
                        &format!("{context}.lifecycleClips"),
                    )?;
                    if !clips.contains_key(clip) {
                        return Err(format!(
                            "{context}.lifecycleClips.{lifecycle} references missing clip '{clip}'"
                        ));
                    }
                }
                if layer
                    .get("reducedMotionFrame")
                    .and_then(serde_json::Value::as_u64)
                    .is_none()
                {
                    return Err(format!(
                        "{context}.reducedMotionFrame must be a non-negative integer"
                    ));
                }
            }
        }
        ThemeRenderer::Particles => {
            if !config
                .get("emitters")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|emitters| !emitters.is_empty())
            {
                return Err(
                    "particles overlay.config.emitters must be a non-empty array".to_string(),
                );
            }
            let reduced = required_config_string(config, "reducedMotionAsset", "particles config")?;
            validate_asset(root, reduced, Some("png"))?;
        }
        ThemeRenderer::Web => {
            let entry = required_config_string(config, "entry", "web config")?;
            validate_asset(root, entry, Some("js"))?;
            let reduced = required_config_string(config, "reducedMotionAsset", "web config")?;
            validate_asset(root, reduced, Some("png"))?;
            if let Some(assets_value) = config.get("assets") {
                let assets = assets_value
                    .as_object()
                    .ok_or_else(|| "web overlay.config.assets must be an object".to_string())?;
                for (name, value) in assets {
                    let path = value
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| {
                            format!("web overlay.config.assets.{name} must be a non-empty string")
                        })?;
                    validate_asset(root, path, Some("png"))?;
                }
            }
        }
    }
    Ok(())
}

fn load_and_validate_pack(root: &Path) -> Result<ThemePackManifest, String> {
    inspect_pack_tree(root)?;
    let manifest_path = root.join("manifest.json");
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("failed to read '{}': {error}", manifest_path.display()))?;
    let manifest: ThemePackManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("invalid theme manifest: {error}"))?;

    if manifest.schema_version != THEME_SCHEMA_VERSION {
        return Err(format!(
            "unsupported theme schema version {}; expected {}",
            manifest.schema_version, THEME_SCHEMA_VERSION
        ));
    }
    if !validate_slug(&manifest.id) || manifest.id == CLASSIC_THEME_ID {
        return Err("theme id must be a lowercase ASCII slug and cannot be 'classic'".to_string());
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 100 {
        return Err("theme name must be between 1 and 100 characters".to_string());
    }
    if !(32..=2048).contains(&manifest.overlay.width)
        || !(32..=2048).contains(&manifest.overlay.height)
    {
        return Err("overlay width and height must be between 32 and 2048".to_string());
    }

    validate_asset(root, &manifest.preview, Some("png"))?;
    validate_renderer_config(root, &manifest.overlay)?;
    if let Some(post_processing) = &manifest.preset.post_processing {
        if let Some(profile) = &post_processing.profile {
            let expected_id = format!("theme:{}", manifest.id);
            if profile.id != expected_id {
                return Err(format!("theme-owned profile id must be '{expected_id}'"));
            }
            if profile.name.trim().is_empty() || profile.prompt.trim().is_empty() {
                return Err("post-processing profile name and prompt cannot be empty".to_string());
            }
        }
    }

    Ok(manifest)
}

fn ensure_code_theme_trusted(manifest: &ThemePackManifest, trust_code: bool) -> Result<(), String> {
    if manifest.overlay.renderer == ThemeRenderer::Web && !trust_code {
        Err("CODE_THEME_TRUST_REQUIRED".to_string())
    } else {
        Ok(())
    }
}

fn pack_info(
    root: PathBuf,
    source: ThemePackSource,
    active_id: &str,
) -> Result<ThemePackInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve theme root: {error}"))?;
    let manifest = load_and_validate_pack(&root)?;
    let code_theme = manifest.overlay.renderer == ThemeRenderer::Web;
    Ok(ThemePackInfo {
        active: manifest.id == active_id,
        manifest,
        root: root.to_string_lossy().into_owned(),
        source,
        code_theme,
    })
}

fn discover_root(
    root: &Path,
    source: ThemePackSource,
    active_id: &str,
    packs: &mut BTreeMap<String, ThemePackInfo>,
) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| {
        format!(
            "failed to read theme directory '{}': {error}",
            root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("failed to read theme directory entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        match pack_info(path.clone(), source, active_id) {
            Ok(info) => {
                packs.entry(info.manifest.id.clone()).or_insert(info);
            }
            Err(error) => warn!("Ignoring invalid theme pack '{}': {error}", path.display()),
        }
    }
    Ok(())
}

fn discover_theme_packs(app: &AppHandle, active_id: &str) -> Result<Vec<ThemePackInfo>, String> {
    let mut packs = BTreeMap::new();
    if let Ok(root) = bundled_themes_root(app) {
        discover_root(&root, ThemePackSource::Bundled, active_id, &mut packs)?;
    }
    let installed_root = installed_themes_root(app)?;
    discover_root(
        &installed_root,
        ThemePackSource::Installed,
        active_id,
        &mut packs,
    )?;

    let mut classic = classic_info();
    classic.active = active_id == CLASSIC_THEME_ID || !packs.contains_key(active_id);
    let mut result = vec![classic];
    result.extend(packs.into_values());
    Ok(result)
}

fn find_theme_pack(app: &AppHandle, id: &str) -> Result<ThemePackInfo, String> {
    let packs = discover_theme_packs(app, id)?;
    packs
        .into_iter()
        .find(|pack| pack.manifest.id == id)
        .ok_or_else(|| format!("theme pack '{id}' was not found"))
}

fn copy_pack_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "failed to create theme staging directory '{}': {error}",
            destination.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "failed to read theme source '{}': {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("failed to read theme source entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("failed to inspect '{}': {error}", source_path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "theme packs cannot contain symlinks: '{}'",
                source_path.display()
            ));
        }
        if metadata.is_dir() {
            copy_pack_tree(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "failed to copy '{}' to '{}': {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn install_pack_at(source: &Path, installed_root: &Path) -> Result<PathBuf, String> {
    let source_root = manifest_root(source)?;
    let manifest = load_and_validate_pack(&source_root)?;
    fs::create_dir_all(installed_root)
        .map_err(|error| format!("failed to create theme directory: {error}"))?;
    let canonical_installed_root = installed_root
        .canonicalize()
        .map_err(|error| format!("failed to resolve theme directory: {error}"))?;
    if canonical_installed_root.starts_with(&source_root) {
        return Err("theme source cannot contain the application theme directory".to_string());
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))?
        .as_nanos();
    let staging = installed_root.join(format!(".install-{}-{nonce}", manifest.id));
    let backup = installed_root.join(format!(".backup-{}-{nonce}", manifest.id));
    let destination = installed_root.join(&manifest.id);

    let operation = (|| {
        copy_pack_tree(&source_root, &staging)?;
        let copied_manifest = load_and_validate_pack(&staging)?;
        if copied_manifest.id != manifest.id {
            return Err("theme id changed while it was being installed".to_string());
        }
        if destination.exists() {
            fs::rename(&destination, &backup)
                .map_err(|error| format!("failed to stage existing theme update: {error}"))?;
        }
        if let Err(error) = fs::rename(&staging, &destination) {
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(format!("failed to activate installed theme: {error}"));
        }
        if backup.exists() {
            if let Err(error) = fs::remove_dir_all(&backup) {
                warn!(
                    "Theme '{}' installed, but old version cleanup failed: {error}",
                    manifest.id
                );
            }
        }
        Ok(destination.clone())
    })();

    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    if operation.is_err() && backup.exists() && !destination.exists() {
        let _ = fs::rename(&backup, &destination);
    }
    operation
}

fn apply_manifest_to_settings(settings: &mut AppSettings, manifest: &ThemePackManifest) {
    settings.active_theme_pack = manifest.id.clone();
    if let Some(appearance) = manifest.preset.appearance {
        settings.theme = appearance;
    }
    if let Some(accent) = manifest.preset.accent {
        settings.theme_accent = accent;
    }
    if let Some(post_processing) = &manifest.preset.post_processing {
        settings.post_process_enabled = post_processing.enabled;
        if let Some(profile) = &post_processing.profile {
            let prompt = LLMPrompt {
                id: profile.id.clone(),
                name: profile.name.clone(),
                prompt: profile.prompt.clone(),
            };
            if let Some(existing) = settings
                .post_process_prompts
                .iter_mut()
                .find(|existing| existing.id == prompt.id)
            {
                *existing = prompt;
            } else {
                settings.post_process_prompts.push(prompt);
            }
            settings.post_process_selected_prompt_id = Some(profile.id.clone());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn list_theme_packs(app: AppHandle) -> Result<Vec<ThemePackInfo>, String> {
    let active_id = settings::get_settings(&app).active_theme_pack;
    discover_theme_packs(&app, &active_id)
}

#[tauri::command]
#[specta::specta]
pub fn install_theme_pack(
    app: AppHandle,
    source_path: String,
    trust_code: bool,
) -> Result<ThemePackInfo, String> {
    let source_root = manifest_root(Path::new(&source_path))?;
    let source_manifest = load_and_validate_pack(&source_root)?;
    ensure_code_theme_trusted(&source_manifest, trust_code)?;
    if let Ok(bundled_root) = bundled_themes_root(&app) {
        let mut bundled = BTreeMap::new();
        discover_root(
            &bundled_root,
            ThemePackSource::Bundled,
            CLASSIC_THEME_ID,
            &mut bundled,
        )?;
        if bundled.contains_key(&source_manifest.id) {
            return Err(format!(
                "theme id '{}' is reserved by a bundled pack",
                source_manifest.id
            ));
        }
    }
    let installed_root = installed_themes_root(&app)?;
    let destination = install_pack_at(&source_root, &installed_root)?;
    let active_id = settings::get_settings(&app).active_theme_pack;
    let pack = pack_info(destination, ThemePackSource::Installed, &active_id)?;
    if pack.active {
        let _ = app.emit("theme-pack-changed", &pack.manifest.id);
        crate::overlay::sync_overlay_visibility(&app);
    }
    Ok(pack)
}

fn clear_removed_pack_reference(settings: &mut AppSettings, id: &str) -> bool {
    let removed_active = settings.active_theme_pack == id;
    if removed_active {
        settings.active_theme_pack = CLASSIC_THEME_ID.to_string();
    }
    removed_active
}

#[tauri::command]
#[specta::specta]
pub fn remove_theme_pack(app: AppHandle, id: String) -> Result<(), String> {
    if id == CLASSIC_THEME_ID || !validate_slug(&id) {
        return Err("the classic theme cannot be removed".to_string());
    }
    let root = installed_themes_root(&app)?;
    let destination = root.join(&id);
    let info = pack_info(
        destination.clone(),
        ThemePackSource::Installed,
        &settings::get_settings(&app).active_theme_pack,
    )?;
    if info.manifest.id != id {
        return Err("installed theme directory does not match its manifest id".to_string());
    }
    fs::remove_dir_all(&destination)
        .map_err(|error| format!("failed to remove theme pack '{id}': {error}"))?;

    let mut current = settings::get_settings(&app);
    let removed_active = clear_removed_pack_reference(&mut current, &id);
    if removed_active {
        settings::write_settings(&app, current);
    }
    if removed_active {
        let _ = app.emit("theme-pack-changed", CLASSIC_THEME_ID);
        crate::overlay::sync_overlay_visibility(&app);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn apply_theme_pack(app: AppHandle, id: String) -> Result<ThemePackInfo, String> {
    let mut pack = if id == CLASSIC_THEME_ID {
        classic_info()
    } else {
        find_theme_pack(&app, &id)?
    };
    let mut current = settings::get_settings(&app);
    apply_manifest_to_settings(&mut current, &pack.manifest);
    let appearance = current.theme;
    let accent = current.theme_accent;
    let changes_post_processing = pack.manifest.preset.post_processing.is_some();
    settings::write_settings(&app, current);

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    crate::shortcut::apply_window_theme(&app, appearance);
    let _ = app.emit("theme-changed", appearance);
    let _ = app.emit("theme-accent-changed", accent);
    let _ = app.emit("theme-pack-changed", &pack.manifest.id);
    if changes_post_processing {
        let persisted = settings::get_settings(&app);
        crate::shortcut::reconcile_post_process_shortcut(&app, &persisted);
    }
    crate::overlay::sync_overlay_visibility(&app);
    pack.active = true;
    Ok(pack)
}

#[tauri::command]
#[specta::specta]
pub fn get_active_theme_pack(app: AppHandle) -> Result<ThemePackInfo, String> {
    let active_id = settings::get_settings(&app).active_theme_pack;
    if active_id != CLASSIC_THEME_ID {
        if let Ok(mut pack) = find_theme_pack(&app, &active_id) {
            pack.active = true;
            return Ok(pack);
        }
    }
    let mut classic = classic_info();
    classic.active = true;
    Ok(classic)
}

pub fn active_overlay_window_config(app: &AppHandle) -> Option<OverlayWindowConfig> {
    let active_id = settings::get_settings(app).active_theme_pack;
    if active_id == CLASSIC_THEME_ID {
        return None;
    }
    find_theme_pack(app, &active_id)
        .ok()
        .map(|pack| OverlayWindowConfig {
            width: pack.manifest.overlay.width,
            height: pack.manifest.overlay.height,
            anchor: pack.manifest.overlay.anchor,
            pointer_mode: pack.manifest.overlay.pointer_mode,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG_1X1: &[u8] = &[
        0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0,
        0, 1, 0, 0, 0, 1,
    ];

    fn write_valid_pack(root: &Path, id: &str) {
        fs::create_dir_all(root.join("assets")).expect("create assets");
        fs::write(root.join("preview.png"), PNG_1X1).expect("write preview");
        fs::write(root.join("assets/art.png"), PNG_1X1).expect("write art");
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "id": id,
            "name": "Test theme",
            "description": "test",
            "author": "tester",
            "preview": "preview.png",
            "overlay": {
                "renderer": "reactive-image",
                "width": 384,
                "height": 256,
                "anchor": "bottom-center",
                "pointerMode": "passthrough",
                "config": { "layers": [{ "asset": "assets/art.png" }] }
            }
        });
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
    }

    #[test]
    fn validates_a_safe_v1_pack() {
        let temp = TempDir::new().expect("temp dir");
        write_valid_pack(temp.path(), "test-theme");
        let manifest = load_and_validate_pack(temp.path()).expect("valid theme");
        assert_eq!(manifest.id, "test-theme");
        assert_eq!(manifest.overlay.renderer, ThemeRenderer::ReactiveImage);
    }

    #[test]
    fn rejects_traversal_and_missing_config_assets() {
        assert!(safe_relative_path("../outside.png").is_err());
        assert!(safe_relative_path("C:/outside.png").is_err());
        let temp = TempDir::new().expect("temp dir");
        write_valid_pack(temp.path(), "test-theme");
        let manifest_path = temp.path().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest"))
                .expect("parse manifest");
        manifest["overlay"]["config"]["layers"][0]["asset"] =
            serde_json::json!("assets/missing.png");
        fs::write(
            manifest_path,
            serde_json::to_vec(&manifest).expect("serialize manifest"),
        )
        .expect("rewrite manifest");
        assert!(load_and_validate_pack(temp.path())
            .expect_err("missing asset rejected")
            .contains("missing"));
    }

    #[test]
    fn rejects_symlinks_or_unsupported_files() {
        let temp = TempDir::new().expect("temp dir");
        write_valid_pack(temp.path(), "test-theme");
        fs::write(temp.path().join("payload.exe"), b"nope").expect("write unsupported file");
        assert!(load_and_validate_pack(temp.path())
            .expect_err("unsupported file rejected")
            .contains("unsupported theme file type"));
    }

    #[test]
    fn installs_from_a_manifest_path_and_revalidates_the_copy() {
        let source = TempDir::new().expect("source temp dir");
        let installed = TempDir::new().expect("installed temp dir");
        write_valid_pack(source.path(), "test-theme");
        let destination = install_pack_at(&source.path().join("manifest.json"), installed.path())
            .expect("install theme");
        assert_eq!(destination, installed.path().join("test-theme"));
        assert_eq!(
            load_and_validate_pack(&destination)
                .expect("installed pack valid")
                .id,
            "test-theme"
        );
    }

    #[test]
    fn web_theme_requires_explicit_trust_before_install() {
        let mut manifest = classic_manifest();
        manifest.id = "code-theme".into();
        manifest.overlay.renderer = ThemeRenderer::Web;
        assert_eq!(
            ensure_code_theme_trusted(&manifest, false).expect_err("trust must be required"),
            "CODE_THEME_TRUST_REQUIRED"
        );
        assert!(ensure_code_theme_trusted(&manifest, true).is_ok());
    }

    #[test]
    fn absent_preset_fields_are_omitted_for_frontend_validation() {
        let serialized = serde_json::to_value(classic_manifest()).expect("serialize manifest");
        let preset = serialized["preset"].as_object().expect("preset object");
        assert!(preset.is_empty());

        let post_processing = ThemePostProcessingPreset {
            enabled: false,
            profile: None,
        };
        let serialized =
            serde_json::to_value(post_processing).expect("serialize post-processing preset");
        assert!(serialized.get("profile").is_none());
    }

    #[test]
    fn applying_a_preset_updates_only_owned_fields() {
        let mut settings = settings::get_default_settings();
        settings
            .post_process_api_keys
            .insert("openai".into(), "secret".into());
        settings.post_process_prompts.push(LLMPrompt {
            id: "mine".into(),
            name: "Mine".into(),
            prompt: "keep me".into(),
        });
        let mut manifest = classic_manifest();
        manifest.id = "pirate-scribe".into();
        manifest.preset = ThemePreset {
            appearance: Some(Theme::Dark),
            accent: Some(ThemeAccent::Amber),
            post_processing: Some(ThemePostProcessingPreset {
                enabled: true,
                profile: Some(ThemePostProcessProfile {
                    id: "theme:pirate-scribe".into(),
                    name: "Pirate polish".into(),
                    prompt: "Make it salty".into(),
                }),
            }),
        };

        apply_manifest_to_settings(&mut settings, &manifest);

        assert_eq!(settings.active_theme_pack, "pirate-scribe");
        apply_manifest_to_settings(&mut settings, &classic_manifest());
        assert_eq!(settings.active_theme_pack, CLASSIC_THEME_ID);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.theme_accent, ThemeAccent::Amber);
        assert!(settings.post_process_enabled);
        assert_eq!(
            settings
                .post_process_api_keys
                .get("openai")
                .map(String::as_str),
            Some("secret")
        );
        assert!(settings
            .post_process_prompts
            .iter()
            .any(|prompt| prompt.id == "mine"));
        assert_eq!(
            settings.post_process_selected_prompt_id.as_deref(),
            Some("theme:pirate-scribe")
        );
    }

    #[test]
    fn applying_profile_again_upserts_instead_of_duplicating() {
        let mut settings = settings::get_default_settings();
        let mut manifest = classic_manifest();
        manifest.id = "test-theme".into();
        manifest.preset.post_processing = Some(ThemePostProcessingPreset {
            enabled: true,
            profile: Some(ThemePostProcessProfile {
                id: "theme:test-theme".into(),
                name: "First".into(),
                prompt: "first".into(),
            }),
        });
        apply_manifest_to_settings(&mut settings, &manifest);
        manifest
            .preset
            .post_processing
            .as_mut()
            .and_then(|preset| preset.profile.as_mut())
            .expect("profile")
            .prompt = "updated".into();
        apply_manifest_to_settings(&mut settings, &manifest);

        let matching: Vec<_> = settings
            .post_process_prompts
            .iter()
            .filter(|prompt| prompt.id == "theme:test-theme")
            .collect();
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].prompt, "updated");
    }

    #[test]
    fn removing_active_pack_clears_its_visual_selection() {
        let mut settings = settings::get_default_settings();
        settings.active_theme_pack = "pirate-scribe".into();

        let changed = clear_removed_pack_reference(&mut settings, "pirate-scribe");

        assert!(changed);
        assert_eq!(settings.active_theme_pack, CLASSIC_THEME_ID);
    }

    #[test]
    fn renderer_asset_fields_reject_traversal_without_extension_guessing() {
        let temp = TempDir::new().expect("temp dir");
        fs::create_dir_all(temp.path().join("assets")).expect("create assets");
        fs::write(temp.path().join("assets/fallback.png"), PNG_1X1).expect("write fallback");
        fs::create_dir_all(temp.path().join("web")).expect("create web dir");
        fs::write(temp.path().join("web/theme.js"), b"export default {}").expect("write entry");

        let overlay = ThemeOverlayManifest {
            renderer: ThemeRenderer::Web,
            width: 200,
            height: 100,
            anchor: ThemeOverlayAnchor::BottomCenter,
            pointer_mode: ThemePointerMode::Passthrough,
            config: serde_json::json!({
                "entry": "../outside",
                "reducedMotionAsset": "assets/fallback.png",
                "assets": {}
            }),
        };

        assert!(validate_renderer_config(temp.path(), &overlay)
            .expect_err("traversal rejected")
            .contains("unsafe asset path"));
    }

    #[test]
    fn malformed_renderer_structure_is_rejected_during_import() {
        let temp = TempDir::new().expect("temp dir");
        let overlay = ThemeOverlayManifest {
            renderer: ThemeRenderer::ReactiveImage,
            width: 200,
            height: 100,
            anchor: ThemeOverlayAnchor::BottomCenter,
            pointer_mode: ThemePointerMode::Passthrough,
            config: serde_json::json!({ "asset": "assets/art.png" }),
        };

        assert!(validate_renderer_config(temp.path(), &overlay)
            .expect_err("missing layers rejected")
            .contains("layers"));
    }
}
