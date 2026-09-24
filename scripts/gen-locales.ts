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
  cryptoRatesUpdated: {
    en: 'Crypto $1', fr: 'Crypto $1', es: 'Cripto $1', de: 'Krypto $1',
    pt_BR: 'Cripto $1', it: 'Cripto $1', ja: '暗号資産 $1', zh_CN: '加密货币 $1',
  },
  cryptoRatesNever: {
    en: 'Crypto rates not loaded', fr: 'Taux crypto non chargés',
    es: 'Tasas cripto no cargadas', de: 'Krypto-Kurse nicht geladen',
    pt_BR: 'Taxas de cripto não carregadas', it: 'Tassi cripto non caricati',
    ja: '暗号資産レート未取得', zh_CN: '加密货币汇率未加载',
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
    en: 'Currency read from the site, not from the price',
    fr: 'Devise déduite du site, pas du prix',
    es: 'Moneda deducida del sitio, no del precio',
    de: 'Währung aus der Website abgeleitet, nicht aus dem Preis',
    pt_BR: 'Moeda deduzida do site, não do preço',
    it: 'Valuta dedotta dal sito, non dal prezzo',
    ja: '価格ではなくサイトから通貨を推定しました',
    zh_CN: '货币根据网站推断，而非价格本身',
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
  inlineStyle: {
    en: 'In the page, show', fr: 'Dans la page, afficher',
    es: 'En la página, mostrar', de: 'Auf der Seite anzeigen',
    pt_BR: 'Na página, mostrar', it: 'Nella pagina, mostra',
    ja: 'ページ内の表示', zh_CN: '页面中显示',
  },
  inlineStyleHelp: {
    en: 'Replacing hides the site’s price without deleting it. Hover shows it again.',
    fr: 'Le remplacement masque le prix du site sans le supprimer. Le survol le réaffiche.',
    es: 'Reemplazar oculta el precio del sitio sin borrarlo. El cursor lo vuelve a mostrar.',
    de: 'Ersetzen blendet den Preis der Seite aus, ohne ihn zu löschen. Der Tooltip zeigt ihn wieder.',
    pt_BR: 'Substituir oculta o preço do site sem apagá-lo. O cursor mostra ele de novo.',
    it: 'Sostituire nasconde il prezzo del sito senza cancellarlo. Il cursore lo mostra di nuovo.',
    ja: '置き換えてもサイトの価格は削除されず、隠れるだけです。ホバーで再表示されます。',
    zh_CN: '替换只是隐藏网站原价，并未删除。悬停即可再次看到。',
  },
  inlineStyleBadge: {
    en: 'Both prices', fr: 'Les deux prix', es: 'Ambos precios',
    de: 'Beide Preise', pt_BR: 'Os dois preços', it: 'Entrambi i prezzi',
    ja: '両方の価格', zh_CN: '两个价格',
  },
  inlineStyleReplace: {
    en: 'Mine only', fr: 'Le mien seulement', es: 'Solo el mío',
    de: 'Nur meinen', pt_BR: 'Só o meu', it: 'Solo il mio',
    ja: '自国通貨のみ', zh_CN: '只显示我的',
  },
  pageContext: {
    en: 'Read $, kr and ¥ from the site',
    fr: 'Lire $, kr et ¥ d’après le site',
    es: 'Leer $, kr y ¥ según el sitio',
    de: '$, kr und ¥ anhand der Website lesen',
    pt_BR: 'Ler $, kr e ¥ conforme o site',
    it: 'Leggere $, kr e ¥ in base al sito',
    ja: 'サイトに応じて $・kr・¥ を解釈する',
    zh_CN: '根据网站解读 $、kr 和 ¥',
  },
  pageContextHelp: {
    en: 'On .ca, $ is Canadian. A table row or a page that names its currency (CNY, CAD) is believed, and the page is remembered for the site. Off, only your locks apply.',
    fr: 'Sur .ca, $ vaut dollar canadien. Une ligne de tableau ou une page qui nomme sa devise (CNY, CAD) est crue, et la page est retenue pour le site. Désactivé, seuls vos verrous comptent.',
    es: 'En .ca, $ es dólar canadiense. Una fila o una página que nombra su moneda (CNY, CAD) se tiene en cuenta, y la página se recuerda para el sitio. Desactivado, solo cuentan tus bloqueos.',
    de: 'Auf .ca ist $ kanadisch. Eine Tabellenzeile oder Seite, die ihre Währung nennt (CNY, CAD), gilt, und die Seite wird für die Website gemerkt. Aus gelten nur Ihre Festlegungen.',
    pt_BR: 'Em .ca, $ é dólar canadense. Uma linha de tabela ou página que nomeia sua moeda (CNY, CAD) é considerada, e a página fica lembrada para o site. Desligado, só valem seus bloqueios.',
    it: 'Su .ca, $ è dollaro canadese. Una riga o una pagina che nomina la sua valuta (CNY, CAD) viene creduta, e la pagina è ricordata per il sito. Disattivato, valgono solo i tuoi blocchi.',
    ja: '.ca では $ をカナダドルと解釈。通貨名（CNY、CAD）を示す表の行やページに従い、ページの情報はサイトごとに記憶します。オフなら固定したサイトだけが対象です。',
    zh_CN: '在 .ca 上 $ 表示加元。表格行或页面写明货币（CNY、CAD）时以其为准，并按网站记住。关闭后只有你锁定的网站生效。',
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
  siteAction: {
    en: 'On this site', fr: 'Sur ce site', es: 'En este sitio', de: 'Auf dieser Website',
    pt_BR: 'Neste site', it: 'Su questo sito', ja: 'このサイトでは', zh_CN: '在此网站上',
  },
  siteActionPause: {
    en: 'Pause', fr: 'Suspendre', es: 'Pausar', de: 'Pausieren',
    pt_BR: 'Pausar', it: 'Sospendere', ja: '一時停止', zh_CN: '暂停',
  },
  siteActionLock: {
    en: 'Lock the currency', fr: 'Verrouiller la devise', es: 'Fijar la moneda',
    de: 'Währung festlegen', pt_BR: 'Fixar a moeda', it: 'Bloccare la valuta',
    ja: '通貨を固定', zh_CN: '锁定货币',
  },
  siteLockCurrency: {
    en: 'Currency for $, kr or ¥', fr: 'Devise pour $, kr ou ¥', es: 'Moneda para $, kr o ¥',
    de: 'Währung für $, kr oder ¥', pt_BR: 'Moeda para $, kr ou ¥', it: 'Valuta per $, kr o ¥',
    ja: '$・kr・¥ の通貨', zh_CN: '$、kr 或 ¥ 的货币',
  },
  lockedSites: {
    en: 'Locked currencies', fr: 'Devises verrouillées', es: 'Monedas fijadas',
    de: 'Festgelegte Währungen', pt_BR: 'Moedas fixadas', it: 'Valute bloccate',
    ja: '固定した通貨', zh_CN: '已锁定的货币',
  },
  lockedSitesHelp: {
    en: 'On these sites the symbol always means the currency you chose, whatever the page suggests.',
    fr: 'Sur ces sites, le symbole vaut toujours la devise choisie, quoi que suggère la page.',
    es: 'En estos sitios el símbolo siempre es la moneda elegida, diga lo que diga la página.',
    de: 'Auf diesen Websites steht das Symbol immer für die gewählte Währung, egal was die Seite nahelegt.',
    pt_BR: 'Nestes sites o símbolo sempre é a moeda escolhida, não importa o que a página sugira.',
    it: 'Su questi siti il simbolo vale sempre la valuta scelta, qualunque cosa suggerisca la pagina.',
    ja: 'これらのサイトでは、ページの内容にかかわらず記号を選んだ通貨として扱います。',
    zh_CN: '在这些网站上，无论页面如何提示，该符号始终表示你选择的货币。',
  },
  lockedSitesEmpty: {
    en: 'No currency is locked.', fr: 'Aucune devise verrouillée.', es: 'Ninguna moneda fijada.',
    de: 'Keine Währung festgelegt.', pt_BR: 'Nenhuma moeda fixada.', it: 'Nessuna valuta bloccata.',
    ja: '固定した通貨はありません。', zh_CN: '没有锁定的货币。',
  },
  learnedSites: {
    en: 'Read from the sites', fr: 'Lu sur les sites', es: 'Leído en los sitios',
    de: 'Von den Websites gelesen', pt_BR: 'Lido nos sites', it: 'Letto dai siti',
    ja: 'サイトから読み取った通貨', zh_CN: '从网站读取',
  },
  learnedSitesHelp: {
    en: 'The currency a site’s own pages named, remembered on this device only. The domain and your locks come first.',
    fr: 'La devise nommée par les pages du site, retenue sur cet appareil uniquement. Le domaine et vos verrous passent avant.',
    es: 'La moneda que nombran las páginas del sitio, recordada solo en este dispositivo. El dominio y tus bloqueos van primero.',
    de: 'Die Währung, die die Seiten der Website nennen, nur auf diesem Gerät gemerkt. Domain und Ihre Festlegungen haben Vorrang.',
    pt_BR: 'A moeda que as páginas do site nomeiam, lembrada só neste dispositivo. O domínio e seus bloqueios vêm antes.',
    it: 'La valuta nominata dalle pagine del sito, ricordata solo su questo dispositivo. Il dominio e i tuoi blocchi vengono prima.',
    ja: 'サイトのページが示した通貨を、この端末にだけ記憶します。ドメインと固定した通貨が優先されます。',
    zh_CN: '网站页面写明的货币，仅保存在本设备上。域名和你的锁定优先。',
  },
  learnedSitesEmpty: {
    en: 'Nothing read yet.', fr: 'Rien de lu pour l’instant.', es: 'Nada leído todavía.',
    de: 'Noch nichts gelesen.', pt_BR: 'Nada lido ainda.', it: 'Ancora niente.',
    ja: 'まだありません。', zh_CN: '暂无内容。',
  },
  reset: {
    en: 'Reset to defaults', fr: 'Réinitialiser', es: 'Restablecer',
    de: 'Zurücksetzen', pt_BR: 'Restaurar padrões', it: 'Ripristina',
    ja: '初期設定に戻す', zh_CN: '恢复默认',
  },
  resetWarning: {
    en: 'This clears every setting, including your paused and locked sites and what sites taught it. It cannot be undone.',
    fr: 'Cela efface tous les réglages, y compris vos sites suspendus et verrouillés et ce que les sites lui ont appris. C’est irréversible.',
    es: 'Esto borra todos los ajustes, incluidos tus sitios pausados y bloqueados y lo aprendido de los sitios. No se puede deshacer.',
    de: 'Das löscht alle Einstellungen, auch pausierte und festgelegte Websites und das von Websites Gelernte. Es lässt sich nicht rückgängig machen.',
    pt_BR: 'Isso apaga todas as configurações, inclusive sites pausados e bloqueados e o que foi aprendido dos sites. Não dá para desfazer.',
    it: 'Questo cancella tutte le impostazioni, inclusi i siti sospesi e bloccati e ciò che ha appreso dai siti. Non è reversibile.',
    ja: '一時停止・固定したサイトやサイトから学んだ内容を含め、すべての設定が消えます。元に戻せません。',
    zh_CN: '这会清除所有设置，包括已暂停和已锁定的网站以及从网站学到的内容，且无法撤销。',
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
  pageAccessTitle: {
    en: 'PriceHover cannot read pages yet',
    fr: 'PriceHover ne peut pas encore lire les pages',
    es: 'PriceHover aún no puede leer las páginas',
    de: 'PriceHover kann Seiten noch nicht lesen',
    pt_BR: 'O PriceHover ainda não consegue ler as páginas',
    it: 'PriceHover non può ancora leggere le pagine',
    ja: 'PriceHover はまだページを読み取れません',
    zh_CN: 'PriceHover 还无法读取页面',
  },
  pageAccessBody: {
    en: 'Your browser is holding back access to the sites you visit, so no price is detected anywhere. Grant it, then reload the tabs you already have open.',
    fr: 'Votre navigateur retient l’accès aux sites que vous visitez, donc aucun prix n’est détecté nulle part. Accordez-le, puis rechargez les onglets déjà ouverts.',
    es: 'Tu navegador está reteniendo el acceso a los sitios que visitas, así que no se detecta ningún precio. Concédelo y recarga las pestañas ya abiertas.',
    de: 'Ihr Browser hält den Zugriff auf die von Ihnen besuchten Websites zurück, daher wird nirgends ein Preis erkannt. Erteilen Sie ihn und laden Sie bereits offene Tabs neu.',
    pt_BR: 'Seu navegador está retendo o acesso aos sites que você visita, então nenhum preço é detectado. Conceda o acesso e recarregue as abas já abertas.',
    it: 'Il browser sta trattenendo l’accesso ai siti che visiti, quindi non viene rilevato alcun prezzo. Concedilo, poi ricarica le schede già aperte.',
    ja: 'ブラウザーが訪問先サイトへのアクセスを保留しているため、どこでも価格が検出されません。アクセスを許可し、開いているタブを再読み込みしてください。',
    zh_CN: '浏览器扣留了对你所访问网站的访问权限，因此任何地方都检测不到价格。请授予权限，然后重新加载已打开的标签页。',
  },
  pageAccessGrant: {
    en: 'Allow on all sites', fr: 'Autoriser sur tous les sites',
    es: 'Permitir en todos los sitios', de: 'Auf allen Websites erlauben',
    pt_BR: 'Permitir em todos os sites', it: 'Consenti su tutti i siti',
    ja: 'すべてのサイトで許可', zh_CN: '在所有网站上允许',
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
