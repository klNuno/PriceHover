/**
 * Writes public/_locales/<locale>/messages.json from the table below.
 *
 * One table rather than eight hand-kept files: a key added to `en` and
 * forgotten elsewhere shows up as a build error here instead of as an English
 * string leaking into a French popup. Run `bun run locales` after touching it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['en', 'fr', 'es', 'de', 'pt_BR', 'it', 'ja', 'zh_CN'] as const;
type Locale = (typeof LOCALES)[number];

type Entry = Record<Locale, string>;

const MESSAGES: Record<string, Entry> = {
  extName: {
    en: 'PriceHover', fr: 'PriceHover', es: 'PriceHover', de: 'PriceHover',
    pt_BR: 'PriceHover', it: 'PriceHover', ja: 'PriceHover', zh_CN: 'PriceHover',
  },
  extDescription: {
    en: 'Hover any price on any page to see it in your own currency.',
    fr: 'Survolez un prix sur n’importe quelle page pour le voir dans votre devise.',
    es: 'Pasa el cursor sobre cualquier precio para verlo en tu moneda.',
    de: 'Fahren Sie über einen Preis, um ihn in Ihrer Währung zu sehen.',
    pt_BR: 'Passe o cursor sobre qualquer preço para vê-lo na sua moeda.',
    it: 'Passa il cursore su un prezzo per vederlo nella tua valuta.',
    ja: 'ページ上の価格にカーソルを合わせると自国通貨で表示します。',
    zh_CN: '将鼠标悬停在任意价格上，即可查看本币金额。',
  },

  // ── Popup ────────────────────────────────────────────────────────────────
  searchPlaceholder: {
    en: 'Search or type a price…', fr: 'Rechercher ou saisir un prix…',
    es: 'Buscar o escribir un precio…', de: 'Suchen oder Preis eingeben…',
    pt_BR: 'Buscar ou digitar um preço…', it: 'Cerca o digita un prezzo…',
    ja: '検索、または価格を入力…', zh_CN: '搜索或输入价格…',
  },
  searchLabel: {
    en: 'Search currencies', fr: 'Rechercher une devise', es: 'Buscar monedas',
    de: 'Währungen suchen', pt_BR: 'Buscar moedas', it: 'Cerca valute',
    ja: '通貨を検索', zh_CN: '搜索货币',
  },
  noResults: {
    en: 'No results', fr: 'Aucun résultat', es: 'Sin resultados',
    de: 'Keine Treffer', pt_BR: 'Nenhum resultado', it: 'Nessun risultato',
    ja: '結果なし', zh_CN: '无结果',
  },
  baseCurrency: {
    en: 'Your currency', fr: 'Votre devise', es: 'Tu moneda', de: 'Ihre Währung',
    pt_BR: 'Sua moeda', it: 'La tua valuta', ja: '自国通貨', zh_CN: '你的货币',
  },
  baseCurrencyHelp: {
    en: 'Prices already in this currency are left alone.',
    fr: 'Les prix déjà dans cette devise sont ignorés.',
    es: 'Los precios que ya están en esta moneda se ignoran.',
    de: 'Preise, die bereits in dieser Währung stehen, bleiben unberührt.',
    pt_BR: 'Preços que já estão nesta moeda são ignorados.',
    it: 'I prezzi già in questa valuta vengono ignorati.',
    ja: 'この通貨で表示されている価格はそのままにします。',
    zh_CN: '已是该货币的价格将被忽略。',
  },
  convertTo: {
    en: 'Convert to', fr: 'Convertir vers', es: 'Convertir a', de: 'Umrechnen in',
    pt_BR: 'Converter para', it: 'Converti in', ja: '変換先', zh_CN: '换算为',
  },
  convertToHelp: {
    en: 'Shown in the tooltip, under your own currency.',
    fr: 'Affichées dans l’infobulle, sous votre devise.',
    es: 'Se muestran en el tooltip, debajo de tu moneda.',
    de: 'Erscheinen im Tooltip unter Ihrer Währung.',
    pt_BR: 'Exibidas na dica, abaixo da sua moeda.',
    it: 'Mostrate nel tooltip, sotto la tua valuta.',
    ja: 'ツールチップ内、自国通貨の下に表示されます。',
    zh_CN: '显示在提示框中，位于你的货币下方。',
  },
  settings: {
    en: 'Settings', fr: 'Réglages', es: 'Ajustes', de: 'Einstellungen',
    pt_BR: 'Configurações', it: 'Impostazioni', ja: '設定', zh_CN: '设置',
  },

  // ── Crypto ───────────────────────────────────────────────────────────────
  // The help text names the second host on purpose. It is the one thing a user
  // is agreeing to, and the browser's own prompt says it in permission terms
  // rather than in plain language.
  cryptoEnabled: {
    en: 'Bitcoin and other crypto', fr: 'Bitcoin et autres cryptos',
    es: 'Bitcoin y otras criptos', de: 'Bitcoin und andere Kryptos',
    pt_BR: 'Bitcoin e outras criptos', it: 'Bitcoin e altre cripto',
    ja: 'ビットコインなどの暗号資産', zh_CN: '比特币及其他加密货币',
  },
  cryptoEnabledHelp: {
    en: 'Adds 24 assets. Rates from api.coingecko.com, contacted hourly only while this is on.',
    fr: 'Ajoute 24 cryptos. Taux via api.coingecko.com, contacté chaque heure tant que ceci est activé.',
    es: 'Añade 24 criptos. Tasas de api.coingecko.com, contactado cada hora solo con esto activado.',
    de: 'Fügt 24 Kryptowerte hinzu. Kurse von api.coingecko.com, stündlich nur bei aktivierter Option.',
    pt_BR: 'Adiciona 24 criptos. Taxas de api.coingecko.com, contatado a cada hora só com isto ativo.',
    it: 'Aggiunge 24 cripto. Tassi da api.coingecko.com, contattato ogni ora solo se attivo.',
    ja: '24種類の暗号資産を追加。レートは api.coingecko.com から、有効な間だけ毎時取得します。',
    zh_CN: '添加 24 种加密资产。汇率来自 api.coingecko.com，仅在开启时每小时连接一次。',
  },
  cryptoDenied: {
    en: 'Crypto stays off without access to api.coingecko.com.',
    fr: 'La crypto reste désactivée sans accès à api.coingecko.com.',
    es: 'Las criptos siguen desactivadas sin acceso a api.coingecko.com.',
    de: 'Krypto bleibt ohne Zugriff auf api.coingecko.com deaktiviert.',
    pt_BR: 'As criptos continuam desativadas sem acesso a api.coingecko.com.',
    it: 'Le cripto restano disattivate senza accesso a api.coingecko.com.',
    ja: 'api.coingecko.com へのアクセスがない場合、暗号資産は無効のままです。',
    zh_CN: '未获得 api.coingecko.com 的访问权限时，加密货币保持关闭。',
  },

  // ── Rates ────────────────────────────────────────────────────────────────
  ratesUpdated: {
    en: 'Rates $1', fr: 'Taux $1', es: 'Tasas $1', de: 'Kurse $1',
    pt_BR: 'Taxas $1', it: 'Tassi $1', ja: 'レート $1', zh_CN: '汇率 $1',
  },
  ratesNever: {
    en: 'Rates not loaded', fr: 'Taux non chargés', es: 'Tasas no cargadas',
    de: 'Kurse nicht geladen', pt_BR: 'Taxas não carregadas',
    it: 'Tassi non caricati', ja: 'レート未取得', zh_CN: '汇率未加载',
  },
  ratesStale: {
    en: 'Rates may be out of date', fr: 'Taux peut-être périmés',
    es: 'Las tasas pueden estar desactualizadas', de: 'Kurse möglicherweise veraltet',
    pt_BR: 'As taxas podem estar desatualizadas', it: 'I tassi potrebbero non essere aggiornati',
    ja: 'レートが古い可能性があります', zh_CN: '汇率可能已过期',
  },
  refresh: {
    en: 'Refresh', fr: 'Actualiser', es: 'Actualizar', de: 'Aktualisieren',
    pt_BR: 'Atualizar', it: 'Aggiorna', ja: '更新', zh_CN: '刷新',
  },
  refreshing: {
    en: 'Refreshing…', fr: 'Actualisation…', es: 'Actualizando…',
    de: 'Wird aktualisiert…', pt_BR: 'Atualizando…', it: 'Aggiornamento…',
    ja: '更新中…', zh_CN: '正在刷新…',
  },
  refreshFailed: {
    en: 'Refresh failed', fr: 'Échec de l’actualisation', es: 'Error al actualizar',
    de: 'Aktualisierung fehlgeschlagen', pt_BR: 'Falha ao atualizar',
    it: 'Aggiornamento non riuscito', ja: '更新に失敗しました', zh_CN: '刷新失败',
  },

  // ── Storage failures ─────────────────────────────────────────────────────
  saveFailed: {
    en: 'Your change could not be saved.',
    fr: 'Votre modification n’a pas pu être enregistrée.',
    es: 'No se pudo guardar tu cambio.',
    de: 'Ihre Änderung konnte nicht gespeichert werden.',
    pt_BR: 'Não foi possível salvar sua alteração.',
    it: 'Non è stato possibile salvare la modifica.',
    ja: '変更を保存できませんでした。',
    zh_CN: '无法保存你的更改。',
  },
  loadFailed: {
    en: 'Your settings could not be read, so nothing will be saved. Try again in a moment.',
    fr: 'Impossible de lire vos réglages, rien ne sera enregistré. Réessayez dans un instant.',
    es: 'No se pudieron leer tus ajustes, así que no se guardará nada. Inténtalo de nuevo en un momento.',
    de: 'Ihre Einstellungen konnten nicht gelesen werden, es wird nichts gespeichert. Versuchen Sie es gleich erneut.',
    pt_BR: 'Não foi possível ler suas configurações, então nada será salvo. Tente de novo em instantes.',
    it: 'Impossibile leggere le tue impostazioni, quindi non verrà salvato nulla. Riprova tra poco.',
    ja: '設定を読み込めなかったため、変更は保存されません。しばらくしてからもう一度お試しください。',
    zh_CN: '无法读取你的设置，因此不会保存任何更改。请稍后再试。',
  },
  timeJustNow: {
    en: 'just now', fr: 'à l’instant', es: 'ahora mismo', de: 'gerade eben',
    pt_BR: 'agora mesmo', it: 'proprio ora', ja: 'たった今', zh_CN: '刚刚',
  },
  timeMinutes: {
    en: '$1 min ago', fr: 'il y a $1 min', es: 'hace $1 min', de: 'vor $1 Min.',
    pt_BR: 'há $1 min', it: '$1 min fa', ja: '$1 分前', zh_CN: '$1 分钟前',
  },
  timeHours: {
    en: '$1 h ago', fr: 'il y a $1 h', es: 'hace $1 h', de: 'vor $1 Std.',
    pt_BR: 'há $1 h', it: '$1 h fa', ja: '$1 時間前', zh_CN: '$1 小时前',
  },
  timeDays: {
    en: '$1 d ago', fr: 'il y a $1 j', es: 'hace $1 d', de: 'vor $1 T.',
    pt_BR: 'há $1 d', it: '$1 g fa', ja: '$1 日前', zh_CN: '$1 天前',
  },

  // ── Tooltip ──────────────────────────────────────────────────────────────
  tooltipNoCurrencies: {
    en: 'No currencies chosen', fr: 'Aucune devise choisie', es: 'Ninguna moneda elegida',
    de: 'Keine Währungen gewählt', pt_BR: 'Nenhuma moeda escolhida',
    it: 'Nessuna valuta scelta', ja: '通貨が選択されていません', zh_CN: '未选择货币',
  },
  tooltipChooseCurrencies: {
    en: 'Open settings', fr: 'Ouvrir les réglages', es: 'Abrir ajustes',
    de: 'Einstellungen öffnen', pt_BR: 'Abrir configurações',
    it: 'Apri impostazioni', ja: '設定を開く', zh_CN: '打开设置',
  },
  tooltipInferred: {
    en: 'Currency read from this site’s country',
    fr: 'Devise déduite du pays de ce site',
    es: 'Moneda deducida del país de este sitio',
    de: 'Währung aus dem Land dieser Website abgeleitet',
    pt_BR: 'Moeda deduzida do país deste site',
    it: 'Valuta dedotta dal paese di questo sito',
    ja: 'サイトの国から通貨を推定しました',
    zh_CN: '根据网站所属国家推断货币',
  },
  tooltipCopyHint: {
    en: 'Click to copy', fr: 'Cliquer pour copier', es: 'Clic para copiar',
    de: 'Zum Kopieren klicken', pt_BR: 'Clique para copiar',
    it: 'Clicca per copiare', ja: 'クリックでコピー', zh_CN: '点击复制',
  },
  tooltipCopied: {
    en: 'Copied', fr: 'Copié', es: 'Copiado', de: 'Kopiert',
    pt_BR: 'Copiado', it: 'Copiato', ja: 'コピーしました', zh_CN: '已复制',
  },

  // ── Enable / pause ───────────────────────────────────────────────────────
  extensionOff: {
    en: 'PriceHover is off', fr: 'PriceHover est désactivé', es: 'PriceHover está apagado',
    de: 'PriceHover ist aus', pt_BR: 'PriceHover está desligado',
    it: 'PriceHover è disattivato', ja: 'PriceHover はオフです', zh_CN: 'PriceHover 已关闭',
  },
  turnOn: {
    en: 'Turn on', fr: 'Activer', es: 'Activar', de: 'Einschalten',
    pt_BR: 'Ativar', it: 'Attiva', ja: 'オンにする', zh_CN: '开启',
  },
  pauseOnSite: {
    en: 'Pause on $1', fr: 'Suspendre sur $1', es: 'Pausar en $1',
    de: 'Auf $1 pausieren', pt_BR: 'Pausar em $1', it: 'Sospendi su $1',
    ja: '$1 で一時停止', zh_CN: '在 $1 上暂停',
  },
  resumeOnSite: {
    en: 'Resume on $1', fr: 'Réactiver sur $1', es: 'Reanudar en $1',
    de: 'Auf $1 fortsetzen', pt_BR: 'Retomar em $1', it: 'Riprendi su $1',
    ja: '$1 で再開', zh_CN: '在 $1 上恢复',
  },
  pausedOnSite: {
    en: 'Paused on $1', fr: 'Suspendu sur $1', es: 'Pausado en $1',
    de: 'Auf $1 pausiert', pt_BR: 'Pausado em $1', it: 'Sospeso su $1',
    ja: '$1 で一時停止中', zh_CN: '已在 $1 上暂停',
  },

  // ── Options ──────────────────────────────────────────────────────────────
  optionsTitle: {
    en: 'PriceHover settings', fr: 'Réglages de PriceHover', es: 'Ajustes de PriceHover',
    de: 'PriceHover-Einstellungen', pt_BR: 'Configurações do PriceHover',
    it: 'Impostazioni di PriceHover', ja: 'PriceHover の設定', zh_CN: 'PriceHover 设置',
  },
  sectionCurrencies: {
    en: 'Currencies', fr: 'Devises', es: 'Monedas', de: 'Währungen',
    pt_BR: 'Moedas', it: 'Valute', ja: '通貨', zh_CN: '货币',
  },
  sectionBehaviour: {
    en: 'Behaviour', fr: 'Comportement', es: 'Comportamiento', de: 'Verhalten',
    pt_BR: 'Comportamento', it: 'Comportamento', ja: '動作', zh_CN: '行为',
  },
  sectionSites: {
    en: 'Sites', fr: 'Sites', es: 'Sitios', de: 'Websites',
    pt_BR: 'Sites', it: 'Siti', ja: 'サイト', zh_CN: '网站',
  },
  sectionAbout: {
    en: 'About', fr: 'À propos', es: 'Acerca de', de: 'Über',
    pt_BR: 'Sobre', it: 'Informazioni', ja: '概要', zh_CN: '关于',
  },
  hoverDelay: {
    en: 'Hover delay', fr: 'Délai de survol', es: 'Retardo al pasar el cursor',
    de: 'Verzögerung beim Überfahren', pt_BR: 'Atraso ao passar o cursor',
    it: 'Ritardo al passaggio', ja: 'ホバー遅延', zh_CN: '悬停延迟',
  },
  hoverDelayHelp: {
    en: 'Pointer stillness before the tooltip opens. Longer means fewer flashing past.',
    fr: 'Immobilité du curseur avant l’infobulle. Plus long, moins de clignotements.',
    es: 'Quietud del cursor antes del tooltip. Más tiempo, menos parpadeos.',
    de: 'Ruhezeit des Zeigers vor dem Tooltip. Länger heißt weniger Aufblitzen.',
    pt_BR: 'Tempo parado antes da dica aparecer. Mais tempo, menos piscadas.',
    it: 'Immobilità del puntatore prima del tooltip. Più lungo, meno lampeggi.',
    ja: 'ツールチップが出るまでの静止時間。長いほど点滅が減ります。',
    zh_CN: '提示框出现前指针需静止的时间。越长，闪烁越少。',
  },
  delayInstant: {
    en: 'Instant', fr: 'Immédiat', es: 'Instantáneo', de: 'Sofort',
    pt_BR: 'Instantâneo', it: 'Immediato', ja: '即時', zh_CN: '立即',
  },
  rounding: {
    en: 'Rounding', fr: 'Arrondi', es: 'Redondeo', de: 'Rundung',
    pt_BR: 'Arredondamento', it: 'Arrotondamento', ja: '丸め', zh_CN: '取整',
  },
  roundingHelp: {
    en: 'A converted price is an estimate. Fewer digits say so.',
    fr: 'Un prix converti est une estimation. Moins de chiffres le disent.',
    es: 'Un precio convertido es una estimación. Menos dígitos lo dicen.',
    de: 'Ein umgerechneter Preis ist eine Schätzung. Weniger Stellen sagen das.',
    pt_BR: 'Um preço convertido é uma estimativa. Menos dígitos deixam isso claro.',
    it: 'Un prezzo convertito è una stima. Meno cifre lo dicono.',
    ja: '換算価格は概算です。桁数を減らすとそれが伝わります。',
    zh_CN: '换算价格只是估算，位数越少越诚实。',
  },
  roundingExact: {
    en: 'Exact', fr: 'Exact', es: 'Exacto', de: 'Genau',
    pt_BR: 'Exato', it: 'Esatto', ja: '正確', zh_CN: '精确',
  },
  roundingSmart: {
    en: 'Smart', fr: 'Intelligent', es: 'Inteligente', de: 'Intelligent',
    pt_BR: 'Inteligente', it: 'Intelligente', ja: 'スマート', zh_CN: '智能',
  },
  roundingInteger: {
    en: 'Whole numbers', fr: 'Nombres entiers', es: 'Números enteros',
    de: 'Ganze Zahlen', pt_BR: 'Números inteiros', it: 'Numeri interi',
    ja: '整数', zh_CN: '整数',
  },
  inlineMode: {
    en: 'Rewrite prices in the page', fr: 'Réécrire les prix dans la page',
    es: 'Reescribir los precios en la página', de: 'Preise auf der Seite ersetzen',
    pt_BR: 'Reescrever os preços na página', it: 'Riscrivi i prezzi nella pagina',
    ja: 'ページ内の価格を書き換える', zh_CN: '直接改写页面中的价格',
  },
  inlineModeHelp: {
    en: 'Your currency beside every price, no hover needed. Hover still opens the list.',
    fr: 'Votre devise à côté de chaque prix, sans survol. Le survol ouvre la liste.',
    es: 'Tu moneda junto a cada precio, sin cursor. El cursor abre la lista.',
    de: 'Ihre Währung neben jedem Preis, ohne Überfahren. Der Tooltip zeigt die Liste.',
    pt_BR: 'Sua moeda ao lado de cada preço, sem cursor. O cursor abre a lista.',
    it: 'La tua valuta accanto a ogni prezzo, senza cursore. Il cursore apre l’elenco.',
    ja: 'ホバーなしで各価格の横に自国通貨を表示。ホバーで一覧が開きます。',
    zh_CN: '无需悬停即显示你的货币。悬停仍会打开列表。',
  },
  pageContext: {
    en: 'Read $, kr and ¥ from the site’s country',
    fr: 'Lire $, kr et ¥ selon le pays du site',
    es: 'Leer $, kr y ¥ según el país del sitio',
    de: '$, kr und ¥ nach dem Land der Website lesen',
    pt_BR: 'Ler $, kr e ¥ conforme o país do site',
    it: 'Leggere $, kr e ¥ in base al paese del sito',
    ja: 'サイトの国に応じて $・kr・¥ を解釈する',
    zh_CN: '根据网站所属国家解读 $、kr 和 ¥',
  },
  pageContextHelp: {
    en: 'On .ca, $ is Canadian. Off, $ and kr always mean USD and SEK.',
    fr: 'Sur .ca, $ vaut dollar canadien. Désactivé, $ et kr valent USD et SEK.',
    es: 'En .ca, $ es dólar canadiense. Desactivado, $ y kr son USD y SEK.',
    de: 'Auf .ca ist $ kanadisch. Aus heißen $ und kr immer USD und SEK.',
    pt_BR: 'Em .ca, $ é dólar canadense. Desligado, $ e kr valem USD e SEK.',
    it: 'Su .ca, $ è dollaro canadese. Disattivato, $ e kr valgono USD e SEK.',
    ja: '.ca では $ をカナダドルと解釈。オフなら $ と kr は常に USD と SEK です。',
    zh_CN: '在 .ca 上 $ 表示加元。关闭后 $ 和 kr 一律视为 USD 和 SEK。',
  },
  enabledEverywhere: {
    en: 'Enabled', fr: 'Activé', es: 'Activado', de: 'Aktiviert',
    pt_BR: 'Ativado', it: 'Attivato', ja: '有効', zh_CN: '已启用',
  },
  enabledEverywhereHelp: {
    en: 'Off means PriceHover does nothing on any page.',
    fr: 'Désactivé, PriceHover ne fait rien sur aucune page.',
    es: 'Desactivado, PriceHover no hace nada en ninguna página.',
    de: 'Aus bedeutet, PriceHover tut auf keiner Seite etwas.',
    pt_BR: 'Desligado, o PriceHover não faz nada em página alguma.',
    it: 'Disattivato, PriceHover non fa nulla su nessuna pagina.',
    ja: 'オフにすると、どのページでも一切動作しません。',
    zh_CN: '关闭后，PriceHover 在任何页面都不会工作。',
  },
  pausedSites: {
    en: 'Paused sites', fr: 'Sites suspendus', es: 'Sitios pausados',
    de: 'Pausierte Websites', pt_BR: 'Sites pausados', it: 'Siti sospesi',
    ja: '一時停止中のサイト', zh_CN: '已暂停的网站',
  },
  pausedSitesEmpty: {
    en: 'No site is paused.', fr: 'Aucun site suspendu.', es: 'Ningún sitio pausado.',
    de: 'Keine Website pausiert.', pt_BR: 'Nenhum site pausado.',
    it: 'Nessun sito sospeso.', ja: '一時停止中のサイトはありません。',
    zh_CN: '没有暂停的网站。',
  },
  addSitePlaceholder: {
    en: 'example.com', fr: 'exemple.com', es: 'ejemplo.com', de: 'beispiel.de',
    pt_BR: 'exemplo.com', it: 'esempio.com', ja: 'example.com', zh_CN: 'example.com',
  },
  add: {
    en: 'Add', fr: 'Ajouter', es: 'Añadir', de: 'Hinzufügen',
    pt_BR: 'Adicionar', it: 'Aggiungi', ja: '追加', zh_CN: '添加',
  },
  remove: {
    en: 'Remove', fr: 'Retirer', es: 'Quitar', de: 'Entfernen',
    pt_BR: 'Remover', it: 'Rimuovi', ja: '削除', zh_CN: '移除',
  },
  moveUp: {
    en: 'Move up', fr: 'Déplacer vers le haut', es: 'Mover arriba',
    de: 'Nach oben verschieben', pt_BR: 'Mover para cima', it: 'Sposta su',
    ja: '上へ移動', zh_CN: '上移',
  },
  moveDown: {
    en: 'Move down', fr: 'Déplacer vers le bas', es: 'Mover abajo',
    de: 'Nach unten verschieben', pt_BR: 'Mover para baixo', it: 'Sposta giù',
    ja: '下へ移動', zh_CN: '下移',
  },
  invalidSite: {
    en: 'That is not a site address. Try example.com.',
    fr: 'Ce n’est pas une adresse de site. Essayez exemple.com.',
    es: 'Eso no es una dirección de sitio. Prueba ejemplo.com.',
    de: 'Das ist keine Website-Adresse. Versuchen Sie beispiel.de.',
    pt_BR: 'Isso não é um endereço de site. Tente exemplo.com.',
    it: 'Non è un indirizzo di sito. Prova esempio.com.',
    ja: 'サイトのアドレスではありません。example.com のように入力してください。',
    zh_CN: '这不是网站地址。请尝试 example.com。',
  },
  reset: {
    en: 'Reset to defaults', fr: 'Réinitialiser', es: 'Restablecer',
    de: 'Zurücksetzen', pt_BR: 'Restaurar padrões', it: 'Ripristina',
    ja: '初期設定に戻す', zh_CN: '恢复默认',
  },
  resetWarning: {
    en: 'This clears every setting, including your paused sites. It cannot be undone.',
    fr: 'Cela efface tous les réglages, y compris vos sites suspendus. C’est irréversible.',
    es: 'Esto borra todos los ajustes, incluidos tus sitios pausados. No se puede deshacer.',
    de: 'Das löscht alle Einstellungen, auch Ihre pausierten Websites. Es lässt sich nicht rückgängig machen.',
    pt_BR: 'Isso apaga todas as configurações, inclusive seus sites pausados. Não dá para desfazer.',
    it: 'Questo cancella tutte le impostazioni, inclusi i siti sospesi. Non è reversibile.',
    ja: '一時停止中のサイトを含め、すべての設定が消えます。元に戻せません。',
    zh_CN: '这会清除所有设置，包括已暂停的网站，且无法撤销。',
  },
  resetConfirm: {
    en: 'Confirm reset', fr: 'Confirmer la réinitialisation', es: 'Confirmar restablecimiento',
    de: 'Zurücksetzen bestätigen', pt_BR: 'Confirmar restauração', it: 'Conferma ripristino',
    ja: 'リセットを確認', zh_CN: '确认恢复默认',
  },
  resetCancel: {
    en: 'Cancel', fr: 'Annuler', es: 'Cancelar', de: 'Abbrechen',
    pt_BR: 'Cancelar', it: 'Annulla', ja: 'キャンセル', zh_CN: '取消',
  },
  version: {
    en: 'Version $1', fr: 'Version $1', es: 'Versión $1', de: 'Version $1',
    pt_BR: 'Versão $1', it: 'Versione $1', ja: 'バージョン $1', zh_CN: '版本 $1',
  },
  privacyPolicy: {
    en: 'Privacy policy', fr: 'Politique de confidentialité', es: 'Política de privacidad',
    de: 'Datenschutzerklärung', pt_BR: 'Política de privacidade',
    it: 'Informativa sulla privacy', ja: 'プライバシーポリシー', zh_CN: '隐私政策',
  },
  privacyNote: {
    en: 'One host for rates, open.er-api.com. What you browse never leaves your browser.',
    fr: 'Un seul hôte pour les taux, open.er-api.com. Vos pages ne quittent pas le navigateur.',
    es: 'Un solo host para las tasas, open.er-api.com. Tus páginas no salen del navegador.',
    de: 'Ein Host für Kurse, open.er-api.com. Ihre Seiten verlassen den Browser nicht.',
    pt_BR: 'Um host para as taxas, open.er-api.com. Suas páginas não saem do navegador.',
    it: 'Un solo host per i tassi, open.er-api.com. Le tue pagine restano nel browser.',
    ja: 'レート取得先は open.er-api.com のみ。閲覧内容がブラウザーの外に出ることはありません。',
    zh_CN: '仅连接 open.er-api.com 获取汇率。你浏览的内容不会离开浏览器。',
  },

  // ── First run ────────────────────────────────────────────────────────────
  welcomeTitle: {
    en: 'PriceHover is ready', fr: 'PriceHover est prêt', es: 'PriceHover está listo',
    de: 'PriceHover ist bereit', pt_BR: 'O PriceHover está pronto',
    it: 'PriceHover è pronto', ja: 'PriceHover の準備ができました', zh_CN: 'PriceHover 已就绪',
  },
  welcomeBody: {
    en: 'Pick your currency, then hover a price.',
    fr: 'Choisissez votre devise, puis survolez un prix.',
    es: 'Elige tu moneda y pasa el cursor sobre un precio.',
    de: 'Währung wählen, dann über einen Preis fahren.',
    pt_BR: 'Escolha sua moeda e passe o cursor sobre um preço.',
    it: 'Scegli la valuta, poi passa il cursore su un prezzo.',
    ja: '通貨を選び、価格にカーソルを合わせてください。',
    zh_CN: '选择货币，然后悬停在价格上。',
  },
  welcomeDismiss: {
    en: 'Got it', fr: 'Compris', es: 'Entendido', de: 'Verstanden',
    pt_BR: 'Entendi', it: 'Ho capito', ja: 'わかりました', zh_CN: '知道了',
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const missing: string[] = [];
for (const [key, entry] of Object.entries(MESSAGES)) {
  for (const locale of LOCALES) {
    if (!entry[locale]?.trim()) missing.push(`${key}.${locale}`);
  }
}
if (missing.length) {
  console.error(`Missing translations:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

/**
 * `chrome.i18n` reads `$` as the start of a placeholder and swallows it when it
 * is meant literally: "Lire $, kr et ¥" came out as "Lire , kr et ¥". A literal
 * dollar has to be written `$$`. `$1`-`$9` are left alone, since those really
 * are substitutions.
 */
const escapeDollars = (message: string): string => message.replace(/\$(?!\d)/g, '$$$$');

for (const locale of LOCALES) {
  const out: Record<string, { message: string }> = {};
  for (const [key, entry] of Object.entries(MESSAGES)) {
    out[key] = { message: escapeDollars(entry[locale]) };
  }
  const dir = join(root, 'public', '_locales', locale);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'messages.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`_locales/${locale}/messages.json  ${Object.keys(out).length} keys`);
}
