# Restore test (audit O03), pasted into Google Cloud Shell by the owner a day after
# cloudshell-backups-setup.sh: the newest Firestore backup is restored into a separate database
# (restore-test, the live data is not touched), its collections are listed next to the live ones,
# the time it took is printed, and the test database is deleted again.
P=kerek-9d153; T=restore-test
gcloud config set project $P -q
B=$(gcloud firestore backups list --format='value(name)' --sort-by=~snapshotTime 2>/dev/null | head -1)
[ -z "$B" ] && { echo "Henuz yedek yok: yarin tekrar deneyin"; exit 0; }
START=$(date +%s)
gcloud firestore databases restore --source-backup="$B" --destination-database=$T -q >/dev/null || { echo "GERI_YUKLEME_BASARISIZ"; exit 1; }
until gcloud firestore databases describe --database=$T --format='value(name)' >/dev/null 2>&1; do sleep 15; done
sleep 60
TOKEN=$(gcloud auth print-access-token)
cols() { curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' "https://firestore.googleapis.com/v1/projects/$P/databases/$1/documents:listCollectionIds" | tr -d ' \n' | sed 's/.*"collectionIds":\[\([^]]*\)\].*/\1/'; }
echo "Canli koleksiyonlar:  $(cols '(default)')"
echo "Yedekten donenler:    $(cols $T)"
echo "Sure: $(( $(date +%s) - START )) saniye"
gcloud firestore databases delete --database=$T -q >/dev/null && echo "Test veritabani silindi"
echo "TAPSYR_GERI_YUKLEME_TAMAM"
