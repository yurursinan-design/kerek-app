# One-time safety net, pasted into Google Cloud Shell by the project owner (audit O03):
# - Firestore point-in-time recovery: any moment of the last 7 days can be read back
# - daily Firestore backups kept 14 days and weekly ones kept 8 weeks
# - files deleted from Cloud Storage are kept 30 days (soft delete) and can be restored
# - an e-mail to the owner when the functions log errors repeatedly (10 minutes) and when the
#   month's bill passes 50 %, 90 % and 100 % of 20 USD
# Safe to paste again: what exists already is left as it is. A restore test follows one day later
# with cloudshell-restore-test.sh (the first backup is made overnight).
P=kerek-9d153; BUCKET=kerek-9d153.firebasestorage.app
# Alerts go to the Google account running this in Cloud Shell (the owner)
MAIL=$(gcloud config get-value account 2>/dev/null)
gcloud config set project $P -q
gcloud services enable monitoring.googleapis.com logging.googleapis.com billingbudgets.googleapis.com -q
gcloud firestore databases update --database='(default)' --enable-pitr -q >/dev/null && echo "Geri sarma (7 gun): tamam"
if ! gcloud firestore backups schedules list --database='(default)' --format='value(name)' 2>/dev/null | grep -q .; then
  gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d -q >/dev/null
  gcloud firestore backups schedules create --database='(default)' --recurrence=weekly --day-of-week=SUN --retention=8w -q >/dev/null
fi; echo "Gunluk ve haftalik yedek: tamam"
gcloud storage buckets update gs://$BUCKET --soft-delete-duration=30d -q >/dev/null && echo "Silinen dosyalar 30 gun saklanir: tamam"
CH=$(gcloud beta monitoring channels list --filter="labels.email_address=$MAIL" --format='value(name)' 2>/dev/null | head -1)
[ -z "$CH" ] && CH=$(gcloud beta monitoring channels create --display-name="Tapsyr owner" --type=email --channel-labels=email_address=$MAIL --format='value(name)' -q)
gcloud logging metrics describe tapsyr_function_errors >/dev/null 2>&1 || gcloud logging metrics create tapsyr_function_errors --description="Errors logged by the Tapsyr functions" --log-filter='resource.type="cloud_run_revision" AND severity>=ERROR' -q >/dev/null
cat > /tmp/tapsyr-alert.json <<JSON
{"displayName":"Tapsyr: functions keep failing","combiner":"OR","notificationChannels":["$CH"],
 "conditions":[{"displayName":"More than 5 errors in 10 minutes","conditionThreshold":{
  "filter":"metric.type=\"logging.googleapis.com/user/tapsyr_function_errors\" AND resource.type=\"cloud_run_revision\"",
  "aggregations":[{"alignmentPeriod":"600s","perSeriesAligner":"ALIGN_SUM","crossSeriesReducer":"REDUCE_SUM"}],
  "comparison":"COMPARISON_GT","thresholdValue":5,"duration":"0s"}}]}
JSON
gcloud alpha monitoring policies list --filter='displayName="Tapsyr: functions keep failing"' --format='value(name)' 2>/dev/null | grep -q . || gcloud alpha monitoring policies create --policy-from-file=/tmp/tapsyr-alert.json -q >/dev/null
echo "Hata uyarisi e-postasi ($MAIL): tamam"
BA=$(gcloud billing projects describe $P --format='value(billingAccountName)' | sed 's#billingAccounts/##')
if [ -n "$BA" ] && ! gcloud billing budgets list --billing-account=$BA --format='value(displayName)' 2>/dev/null | grep -q "Tapsyr monthly"; then
  gcloud billing budgets create --billing-account=$BA --display-name="Tapsyr monthly" --budget-amount=20USD --filter-projects=projects/$P --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 -q >/dev/null
fi; echo "Fatura uyarisi (20 USD): tamam"
echo "TAPSYR_YEDEK_TAMAM"
