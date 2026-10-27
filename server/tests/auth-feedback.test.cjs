'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../../assets/auth-feedback.js');
test('Auth feedback distinguishes service outages, mail restrictions, limits and credential errors',()=>{
 for(const [error,pattern]of [[{status:503},/服務暫時無法使用/],[{name:'AuthRetryableFetchError'},/連線/],[{code:'email_address_not_authorized',status:403},/寄信服務/],[{code:'over_email_send_rate_limit',status:429},/寄送已達/],[{status:429},/限制請求/],[{code:'email_not_confirmed'},/驗證信/],[{code:'invalid_credentials'},/Email 或密碼/],[{code:'signup_disabled'},/暫停新帳號/],[{code:'weak_password'},/12 字元/],[{code:'unknown_provider_error'},/unknown_provider_error/]])assert.match(F.format(error,'signUp'),pattern);
});
test('Auth diagnostics remain readable JSON with only allowed fields and redact private values',()=>{
 const token='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature_secret',d=F.diagnostic({code:'unexpected_failure',status:503,message:'Email private@example.com Bearer '+token,details:'password=private-password postgres://user:secret@db/private',hint:'access_token=secret-token',password:'DO_NOT_LOG',user:{email:'DO_NOT_LOG'},request:{authorization:'DO_NOT_LOG'}},'signUp'),text=JSON.stringify(d);assert.equal(d.code,'unexpected_failure');assert.equal(d.httpStatus,503);assert.deepEqual(Object.keys(d),['operation','httpStatus','code','message','details','hint']);for(const value of ['private@example.com',token,'private-password','user:secret','secret-token','DO_NOT_LOG'])assert(!text.includes(value),value);assert.equal(JSON.parse(text).operation,'signUp');
});
