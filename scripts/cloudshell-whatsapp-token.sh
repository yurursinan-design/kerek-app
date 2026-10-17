# Stores Meta's WhatsApp Business access token (a system user's permanent token) in Secret Manager,
# replacing the placeholder made by cloudshell-login-setup.sh. Pasted into Google Cloud Shell by the
# project owner: paste these lines, press Enter, then paste the token (it is not shown).
gcloud config set project kerek-9d153 -q
read -rsp "WhatsApp erisim anahtari (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
printf '%s' "$K" | gcloud secrets versions add WHATSAPP_TOKEN --data-file=- -q >/dev/null && echo "WhatsApp anahtari: kaydedildi"
