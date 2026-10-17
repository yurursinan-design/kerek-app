# Stores the Telegram Gateway access token (gateway.telegram.org → account settings) in Secret
# Manager for the login codes, then sends one test code to the owner's own Telegram number (free of
# charge for one's own number) to show the token works. Pasted into Google Cloud Shell by the owner.
gcloud config set project kerek-9d153 -q 2>/dev/null
read -rsp "Telegram token (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
{ printf '%s' "$K" | gcloud secrets create TELEGRAM_GATEWAY_TOKEN --data-file=- -q >/dev/null 2>&1 || printf '%s' "$K" | gcloud secrets versions add TELEGRAM_GATEWAY_TOKEN --data-file=- -q >/dev/null; } && echo "Telegram anahtari: kaydedildi"
read -rp "Kendi Telegram numaran (ornek +905xxxxxxxxx): " P
echo "Deneme: $(curl -s -X POST https://gatewayapi.telegram.org/sendVerificationMessage -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d "{\"phone_number\":\"$P\",\"code\":\"246810\",\"ttl\":600}")"
echo "Telegram'a 246810 kodu geldiyse her sey tamam."
