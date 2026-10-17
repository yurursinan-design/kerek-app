# Stores the Anthropic API key (Claude, the review check's judge) in Secret Manager, replacing the
# placeholder the deploy workflows make. Pasted into Google Cloud Shell by the project owner: paste
# these lines, press Enter, then paste the key (it is not shown). The functions read it after their
# next deploy.
gcloud config set project kerek-9d153 -q
gcloud secrets describe ANTHROPIC_API_KEY >/dev/null 2>&1 || printf 'henuz-yok' | gcloud secrets create ANTHROPIC_API_KEY --data-file=- -q >/dev/null
read -rsp "Claude API anahtari (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
case "$K" in sk-ant-*) printf '%s' "$K" | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=- -q >/dev/null && echo "Claude anahtari: kaydedildi" ;; *) echo "Bu bir Claude anahtari degil (sk-ant- ile baslamali); kaydedilmedi" ;; esac
