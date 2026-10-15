# One-time setup for phone login (codes sent to WhatsApp), pasted into Google Cloud Shell by the project owner:
# - roles that let GitHub (github-deploy) upload Cloud Functions, storage rules and Firestore indexes
# - lets the functions' service account sign login tokens (custom tokens)
# - makes the WhatsApp Business access token's place in Secret Manager (a placeholder until Meta's
#   token exists; cloudshell-whatsapp-token.sh stores the real one), so nothing here asks for input
#   and it can be pasted in one go
# - makes the Google Play reviewers' sign-in (fixed number and a random code, no WhatsApp message)
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
# Google Play reviewers sign in with this number and code (Play Console → App access); made once
if ! gcloud secrets describe PLAY_REVIEW_LOGIN >/dev/null 2>&1; then printf '+77000000000:%06d' $(( $(od -An -N4 -tu4 /dev/urandom) % 1000000 )) | gcloud secrets create PLAY_REVIEW_LOGIN --data-file=- -q >/dev/null; fi
if ! gcloud secrets describe WHATSAPP_TOKEN >/dev/null 2>&1; then printf 'henuz-yok' | gcloud secrets create WHATSAPP_TOKEN --data-file=- -q >/dev/null; fi && echo "WhatsApp anahtari: yeri hazir"
gcloud firestore fields ttls update expireAt --collection-group=loginCodes --enable-ttl --async -q >/dev/null 2>&1; gcloud firestore fields ttls update expireAt --collection-group=rateLimits --enable-ttl --async -q >/dev/null 2>&1; gcloud firestore fields ttls update expireAt --collection-group=notifications --enable-ttl --async -q >/dev/null 2>&1; echo "Otomatik temizlik: tamam"
echo "Google inceleme girisi (numara:kod): $(gcloud secrets versions access latest --secret=PLAY_REVIEW_LOGIN)"
echo "KEREK_GIRIS_TAMAM"
