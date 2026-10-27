(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MidnightAuthFeedback=api})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const messages={
  email_address_not_authorized:'驗證信服務尚未開放此信箱，網站管理員需要設定正式寄信服務。',
  over_email_send_rate_limit:'驗證信寄送已達服務上限，請稍後再試；重複點擊註冊不會解除限制。',
  over_request_rate_limit:'帳號操作太頻繁，請稍後再試。',
  signup_disabled:'網站目前暫停新帳號註冊，請聯絡網站管理員。',
  email_provider_disabled:'網站尚未啟用 Email 註冊，請聯絡網站管理員。',
  weak_password:'密碼強度不足，請使用至少 12 字元且不易猜測的密碼。',
  email_address_invalid:'Email 格式不符合要求，請檢查信箱地址。',
  validation_failed:'註冊資料未通過驗證，請檢查 Email 與密碼要求。',
  user_already_exists:'此信箱已註冊，請改用登入。',
  email_exists:'此信箱已註冊，請改用登入。',
  email_not_confirmed:'請先開啟驗證信中的連結，再登入。',
  invalid_credentials:'Email 或密碼不正確，請核對後再登入。',
  otp_expired:'驗證或重設連結已失效或已使用，請回到登入頁；已驗證帳號可直接登入，需要時請重寄最新連結。',
  access_denied:'驗證連結未通過，請使用最新郵件；若已驗證請直接登入。',
  session_not_found:'重設登入狀態已失效，請重新申請密碼重設連結。',
  captcha_failed:'安全驗證未通過，請完成網站提供的驗證後重試。'
 };
 function safe(value){if(value==null)return null;return String(value).slice(0,2000).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/\bBearer\s+\S+/gi,'Bearer [redacted]').replace(/[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/g,'[redacted token]').replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted database URL]').replace(/\b(password|access_token|refresh_token|service_role|apikey)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]').slice(0,600)}
 function diagnostic(error,operation){return {operation,httpStatus:Number.isInteger(error?.status)?error.status:Number.isInteger(error?.httpStatus)?error.httpStatus:0,code:safe(error?.code)||null,message:safe(error?.message)||'Unknown Auth error',details:safe(error?.details),hint:safe(error?.hint)}}
 function format(error,operation){
  const code=error?.code,status=Number(error?.status||error?.httpStatus||0);
  if(messages[code])return messages[code];
  if(status===429)return '帳號服務暫時限制請求次數，請稍後再試。';
  if(status>=500||error?.name==='AuthRetryableFetchError'||error?.name==='AuthUnknownError'&&/fetch|network/i.test(error?.message||''))return '帳號服務暫時無法使用，可能正在恢復、暫停或發生連線問題；請稍後再試。';
  const action=({signUp:'註冊',signIn:'登入',resend:'重寄驗證信',recover:'重設密碼寄信',updatePassword:'更新密碼',verify:'信箱驗證'})[operation]||'帳號操作',suffix=typeof code==='string'&&/^[a-z0-9_]{1,80}$/.test(code)?'（代碼：'+code+'）':'';
  return action+'未完成'+suffix+'，請稍後再試或將錯誤代碼提供給網站管理員。';
 }
 function report(error,operation){console.error('[Midnight Poker / Supabase Auth]',JSON.stringify(diagnostic(error,operation)));return format(error,operation)}
 return {format,diagnostic,report};
});
