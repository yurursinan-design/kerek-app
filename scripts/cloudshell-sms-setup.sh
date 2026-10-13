# One-time setup for SMS login (Mobizon), pasted into Google Cloud Shell by the project owner:
# - roles that let GitHub (github-deploy) upload Cloud Functions, storage rules and Firestore indexes
# - lets the functions' service account sign login tokens (custom tokens)
# - stores the Mobizon API key in Secret Manager (typed in, not shown)
# - lets the functions send push messages to phones (Firebase Cloud Messaging)
# - automatic clean-up of old login codes, rate-limit counters and notices (Firestore TTL)
P=kerek-9d153; SA=github-deploy@$P.iam.gserviceaccount.com
gcloud config set project $P -q
N=$(gcloud projects describe $P --format='value(projectNumber)'); RT=$N-compute@developer.gserviceaccount.com
gcloud services enable secretmanager.googleapis.com iamcredentials.googleapis.com fcm.googleapis.com -q
for r in cloudfunctions.admin run.admin iam.serviceAccountUser artifactregistry.admin secretmanager.admin eventarc.admin pubsub.admin firebasestorage.admin serviceusage.serviceUsageViewer datastore.viewer datastore.indexAdmin; do gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=roles/$r --condition=None -q >/dev/null && echo "Yetki: $r"; done
gcloud iam service-accounts add-iam-policy-binding $RT --member=serviceAccount:$RT --role=roles/iam.serviceAccountTokenCreator -q >/dev/null && echo "Giris anahtari imzalama: tamam"
# Firestore-triggered functions (notifications): event delivery between Firestore, Eventarc and Cloud Run
gcloud projects add-iam-policy-binding $P --member=serviceAccount:service-$N@gcp-sa-pubsub.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator --condition=None -q >/dev/null && echo "Olay iletimi: tamam"
for r in run.invoker eventarc.eventReceiver; do gcloud projects add-iam-policy-binding $P --member=serviceAccount:$RT --role=roles/$r --condition=None -q >/dev/null && echo "Yetki: $r"; done
# The functions send push messages to phones (Firebase Cloud Messaging)
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$RT --role=roles/firebasecloudmessaging.admin --condition=None -q >/dev/null && echo "Telefon bildirimleri: tamam"
# Pasted from a phone, "read" takes the next pasted line instead of the key: paste the lines above
# first, then this line on its own, and only then the key
read -rsp "Mobizon API anahtari (yazarken gorunmez): " K; echo; echo "Uzunluk: ${#K}"
if gcloud secrets describe MOBIZON_API_KEY >/dev/null 2>&1; then printf '%s' "$K" | gcloud secrets versions add MOBIZON_API_KEY --data-file=- -q >/dev/null; else printf '%s' "$K" | gcloud secrets create MOBIZON_API_KEY --data-file=- -q >/dev/null; fi && echo "Mobizon anahtari: kaydedildi"
gcloud firestore fields ttls update expireAt --collection-group=loginCodes --enable-ttl --async -q >/dev/null 2>&1; gcloud firestore fields ttls update expireAt --collection-group=rateLimits --enable-ttl --async -q >/dev/null 2>&1; gcloud firestore fields ttls update expireAt --collection-group=notifications --enable-ttl --async -q >/dev/null 2>&1; echo "Otomatik temizlik: tamam"
echo "KEREK_SMS_TAMAM"
