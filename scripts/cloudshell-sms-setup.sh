# One-time setup for SMS login (Mobizon), pasted into Google Cloud Shell by the project owner:
# - roles that let GitHub (github-deploy) upload Cloud Functions, storage rules and Firestore indexes
# - lets the functions' service account sign login tokens (custom tokens)
# - stores the Mobizon API key in Secret Manager (typed in, not shown)
# - automatic clean-up of old login codes and rate-limit counters (Firestore TTL)
P=kerek-9d153; SA=github-deploy@$P.iam.gserviceaccount.com
gcloud config set project $P -q
N=$(gcloud projects describe $P --format='value(projectNumber)'); RT=$N-compute@developer.gserviceaccount.com
gcloud services enable secretmanager.googleapis.com iamcredentials.googleapis.com -q
for r in cloudfunctions.admin run.admin iam.serviceAccountUser artifactregistry.admin secretmanager.admin eventarc.admin pubsub.admin firebasestorage.admin serviceusage.serviceUsageViewer datastore.viewer datastore.indexAdmin; do gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=roles/$r --condition=None -q >/dev/null && echo "Yetki: $r"; done
gcloud iam service-accounts add-iam-policy-binding $RT --member=serviceAccount:$RT --role=roles/iam.serviceAccountTokenCreator -q >/dev/null && echo "Giris anahtari imzalama: tamam"
# Pasted from a phone, "read" takes the next pasted line instead of the key: paste the lines above
# first, then this line on its own, and only then the key
read -rsp "Mobizon API anahtari (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
if gcloud secrets describe MOBIZON_API_KEY >/dev/null 2>&1; then printf '%s' "$K" | gcloud secrets versions add MOBIZON_API_KEY --data-file=- -q >/dev/null; else printf '%s' "$K" | gcloud secrets create MOBIZON_API_KEY --data-file=- -q >/dev/null; fi && echo "Mobizon anahtari: kaydedildi"
gcloud firestore fields ttls update expireAt --collection-group=loginCodes --enable-ttl --async -q >/dev/null 2>&1; gcloud firestore fields ttls update expireAt --collection-group=rateLimits --enable-ttl --async -q >/dev/null 2>&1; echo "Otomatik temizlik: tamam"
echo "KEREK_SMS_TAMAM"
