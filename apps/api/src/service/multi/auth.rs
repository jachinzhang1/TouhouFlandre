use crate::{app::AppState, error::ApiError, repository::models::Member};
use axum::http::StatusCode;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::TryRng;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

pub fn unauthorized(message: &str) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "GUEST_UNAUTHORIZED", message)
}
pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn generate_token() -> Result<String, ApiError> {
    let mut bytes = [0u8; 32];
    rand::rngs::SysRng.try_fill_bytes(&mut bytes)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
pub fn credential(authorization: &str) -> Result<&str, ApiError> {
    if authorization.is_empty() {
        return Err(unauthorized("缺少令牌。"));
    }
    let credential = authorization
        .strip_prefix("Bearer ")
        .ok_or_else(|| unauthorized("令牌格式错误（期望 Authorization: Bearer guest:{token}）。"))?
        .trim();
    let token = credential
        .strip_prefix("guest:")
        .ok_or_else(|| unauthorized("令牌类型不匹配（期望 guest: 前缀）。"))?;
    if token.is_empty() {
        return Err(unauthorized("令牌为空。"));
    }
    Ok(token)
}
pub async fn authenticate_token(
    pool: &PgPool,
    token: &str,
    allow_left: bool,
) -> Result<Member, ApiError> {
    if token.is_empty() {
        return Err(unauthorized("令牌为空。"));
    }
    let member: Member = sqlx::query_as("SELECT * FROM multi_member WHERE token_hash=$1")
        .bind(hash_token(token))
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| unauthorized("令牌无效。"))?;
    if member.status == "left" && !allow_left {
        return Err(unauthorized("成员已离开。"));
    }
    Ok(member)
}
pub async fn authenticate(
    state: &AppState,
    authorization: &str,
    room_id: &str,
    allow_left: bool,
) -> Result<Member, ApiError> {
    let token = credential(authorization)?;
    let member = authenticate_token(&state.pool, token, allow_left).await?;
    if member.room_id != room_id {
        return Err(unauthorized("令牌不属于该房间。"));
    }
    Ok(member)
}
pub fn require_player(member: &Member) -> Result<(), ApiError> {
    if !member.is_player() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "SPECTATOR_READ_ONLY",
            "观战席只能查看对局。",
        ));
    }
    Ok(())
}
