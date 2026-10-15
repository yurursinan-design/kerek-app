// Spots the usual tricks in a chat message (asking for prepayment, SMS codes or card numbers) so the
// app can show a warning under it. It only warns; the message itself is never changed or hidden.

const PREPAYMENT = /(предоплат|аванс|оплат\S*\s+(заранее|вперёд|вперед)|переведи\S*\s+(сначала|заранее|деньги)|скинь\S*\s+деньг|алдын\s+ала\s+(төле|ақша|аудар)|ақшаны\s+(алдымен|бірінші)\s+аудар)/i;
const SMS_CODE = /((код|code|кодты)[^.!?\n]{0,30}(смс|sms))|((смс|sms)[^.!?\n]{0,30}(код|code|кодты))|(код\s+из\s+(смс|sms))/i;
const CARD_NUMBER = /\b(?:\d[ -]?){15,18}\d\b/;

export type ChatRisk = 'prepayment' | 'smsCode' | 'card';

export function chatRisk(text?: string): ChatRisk | null {
  if (!text) return null;
  if (SMS_CODE.test(text)) return 'smsCode';
  if (CARD_NUMBER.test(text)) return 'card';
  if (PREPAYMENT.test(text)) return 'prepayment';
  return null;
}

export function chatRiskWarning(risk: ChatRisk, language: 'kz' | 'ru'): string {
  const kz = {
    prepayment: 'Абай болыңыз: жұмыс басталмай тұрып алдын ала ақша аудармаңыз.',
    smsCode: 'Абай болыңыз: SMS-кодты ешкімге, тіпті шеберге де айтпаңыз.',
    card: 'Абай болыңыз: карта деректерін чатта жібермеңіз және сұраса бермеңіз.',
  };
  const ru = {
    prepayment: 'Осторожно: не переводите предоплату до начала работы.',
    smsCode: 'Осторожно: никому не называйте коды из SMS, даже мастеру.',
    card: 'Осторожно: не отправляйте и не сообщайте данные карты в чате.',
  };
  return (language === 'kz' ? kz : ru)[risk];
}
