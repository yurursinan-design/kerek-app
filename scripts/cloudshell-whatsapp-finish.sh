# Last step of the WhatsApp login setup, pasted into Google Cloud Shell by the project owner: stores
# Meta's permanent access token in Secret Manager, registers the business number for the Cloud API
# with a new two-step PIN, and prints the number's status (the token itself is never shown).
gcloud config set project kerek-9d153 -q 2>/dev/null
read -rp "Phone number ID: " ID
read -rsp "Erisim anahtari (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
PIN=$(printf '%06d' $(( $(od -An -N4 -tu4 /dev/urandom) % 1000000 )))
printf '%s' "$K" | gcloud secrets versions add WHATSAPP_TOKEN --data-file=- -q >/dev/null && echo "Anahtar: kaydedildi"
echo "Kayit: $(curl -s -X POST "https://graph.facebook.com/v23.0/$ID/register" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d "{\"messaging_product\":\"whatsapp\",\"pin\":\"$PIN\"}")"
echo "Durum: $(curl -s "https://graph.facebook.com/v23.0/$ID?fields=display_phone_number,verified_name,name_status,status,quality_rating" -H "Authorization: Bearer $K")"
echo "Phone number ID: $ID"
echo "Iki adimli dogrulama PIN'i (bir yere yaz, sakla): $PIN"
