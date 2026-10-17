# Last step of the WhatsApp login setup, pasted into Google Cloud Shell by the project owner: stores
# Meta's permanent access token (system user) in Secret Manager, creates the login code template
# (authentication, copy-code button, Russian and Kazakh) through the API, registers the business
# number +7 707 249 2752 for the Cloud API with a new two-step PIN, and prints Meta's answers (the
# token itself is never shown).
gcloud config set project kerek-9d153 -q 2>/dev/null
WABA=1793583535311086; ID=1362374956962825; G=https://graph.facebook.com/v23.0
read -rsp "Erisim anahtari (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
printf '%s' "$K" | gcloud secrets versions add WHATSAPP_TOKEN --data-file=- -q >/dev/null && echo "Anahtar: kaydedildi"
for L in ru kk; do echo "Sablon $L: $(curl -s -X POST "$G/$WABA/message_templates" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d "{\"name\":\"tapsyr_login_code\",\"language\":\"$L\",\"category\":\"AUTHENTICATION\",\"message_send_ttl_seconds\":600,\"components\":[{\"type\":\"BODY\",\"add_security_recommendation\":true},{\"type\":\"FOOTER\",\"code_expiration_minutes\":10},{\"type\":\"BUTTONS\",\"buttons\":[{\"type\":\"OTP\",\"otp_type\":\"COPY_CODE\"}]}]}")"; done
PIN=$(printf '%06d' $(( $(od -An -N4 -tu4 /dev/urandom) % 1000000 )))
echo "Kayit: $(curl -s -X POST "$G/$ID/register" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d "{\"messaging_product\":\"whatsapp\",\"pin\":\"$PIN\"}")"
echo "Durum: $(curl -s "$G/$ID?fields=display_phone_number,verified_name,name_status,status,quality_rating" -H "Authorization: Bearer $K")"
echo "Iki adimli dogrulama PIN'i (bir yere yaz, sakla): $PIN"
