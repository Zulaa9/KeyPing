// Raw dictionary. We will normalize and dedupe at runtime in main.ts
export const RAW_COMMON_WORDS: string[] = [
  // =========================
  // Numeric / easy sequences
  // =========================
  '0','00','000','0000','00000','000000','00000000',
  '1','11','111','1111','11111','111111','11111111',
  '2','22','222','2222','22222','222222','22222222',
  '3','33','333','3333','33333','333333','33333333',
  '4','44','444','4444','44444','444444','44444444',
  '5','55','555','5555','55555','555555','55555555',
  '6','66','666','6666','66666','666666','66666666',
  '7','77','777','7777','77777','777777','77777777',
  '8','88','888','8888','88888','888888','88888888',
  '9','99','999','9999','99999','999999','99999999',
  '12','123','1234','12345','123456','1234567','12345678','123456789','1234567890',
  '0987654321','987654321','87654321','7654321','654321','4321',
  '1212','1122','2211','1100','1010','2020','2000','1999','1990','1980','1970',
  '6969','999999999','314159','271828',
  '1357','13579','2468','9876',
  '112233','223344','123123','321321','147258','2580','0852',

  // =========================
  // Keyboard walks / layouts
  // =========================
  // QWERTY
  'q','qq','qqq','w','ww','www','e','ee','eee',
  'qwe','qwer','qwert','qwerty','qwertyu','qwertyui','qwertyuiop',
  'asdf','asdfg','asdfgh','asdfghj','asdfghjk','asdfghjkl',
  'zxc','zxcv','zxcvb','zxcvbn','zxcvbnm',
  '1q2w3e','1q2w3e4r','q1w2e3r4','!q@w#e','$r%t^y',
  'qaz','wsx','edc','rfv','tgb','yhn','ujm',
  'qazwsx','qazwsxedc',
  // QWERTZ (DE)
  'qwertz','yxcvbn','tzui','asdfghj','yxcvbnm',
  // AZERTY (FR)
  'azerty','azert','qsdf','azer','azertyuiop',
  // DVORAK (por si acaso)
  'aoeui','aoeu','dvorak',
  // Gaming
  'wasd','wasd123','esdf','zqsd',

  // =========================
  // English classics / roots
  // =========================
  'password','password1','password123','passw0rd','p@ssword','p@ssw0rd','pass','pwd','letmein','welcome',
  'admin','administrator','root','superuser','superadmin','owner','user','guest','login','default','system',
  'test','testing','tester','demo','sample','example',
  'secret','secrets','private','priv','hidden','shadow','unknown',
  'hello','hi','thanks','thankyou',
  'love','iloveyou','loveyou','forever','always','friend','friends',
  'sunshine','princess','football','baseball','soccer','hockey','basketball','pokemon','starwars','superman','batman',
  'computer','computers','server','network','internet','intranet',
  'dragon','monkey','flower','summer','winter','spring','autumn','fall',
  'freedom','whatever','trustno1','master','masterkey','masterpass',
  'god','god123','admin123','root123','qwerty123','abc123','abcd1234',
  'money','million','rich','winner','winners','victory','success',
  'home','work','office','school','company','service','email','bank','shop','store',

  // Leetspeak & variants
  'p4ssw0rd','p@ss','p@55w0rd','pa$$word','pa55word','passw0rd!','admin!','adm1n','r00t','us3r',
  'h@ck3r','hack3r','hacker','n1nj4','ninja','l0ve','l0ver','lovers',
  's3cret','s3rv3r','s3rvic3','pr1v4t3','pr1vate',

  // Symbols (raíces típicas con signos)
  'password!','password?','password.','password@','password#',
  'admin!','admin@','admin#','root!','root@','root#',
  'qwerty!','qwerty@','abc123!','abc123@','abc123#',

  // =========================
  // Spanish (sin tildes)
  // =========================
  'contrasena','clave','claves','passworde','seguridad','seguro','usuario','usuarios','administrador','invitado',
  'acceso','accesos','bienvenido','bienvenida','bienvenidos','hola','hola123','secreto','secretos',
  'teamo','tequiero','amor','amores','querida','querido','familia',
  'prueba','pruebas','probar','demo','ejemplo',
  'dinero','banco','correo','correo123','movil','telefono','wifi','internet','red','router',
  'perro','gato','dragon','mono','flores','verano','invierno','primavera','otono',
  // Servicios / marcas comunes ES
  'google','gmail','facebook','instagram','tiktok','twitter','xcom','youtube','microsoft','windows','apple','icloud',
  'movistar','vodafone','orange','jazztel','yoigo','pepephone','masmovil','euskaltel','ono',
  // Roles
  'jefe','empleado','trabajo','escuela','colegio','instituto','empresa','oficina',
  // Euskera / entorno local
  'agur','kaixo','ongi','ongi etorri','euskadi','bilbao','bizkaia','donostia','gasteiz',
  // Catalan/Valenciano (sin tildes)
  'benvingut','benvinguda','contrasenya','usuari','convidat','amor','hola','adeu','valencia','barcelona','girona','tarragona',

  // =========================
  // Portuguese (sin acentos)
  // =========================
  'senha','senhas','seguranca','usuario','utilizador','adm','admin','bemvindo','bemvindos','amor','teste','secreto','privado',

  // =========================
  // French (sin acentos)
  // =========================
  'motdepasse','bonjour','bonsoir','bienvenue','amour','secret','utilisateur','invite','admin','azerty','qsdf','securite',

  // =========================
  // German (umlauts normalizados)
  // =========================
  'passwort','hallo','willkommen','geheim','benutzer','gast','admin','qwertz','sicherheit','lieben','liebe','schatz',

  // =========================
  // Italian
  // =========================
  'passworde','ciao','benvenuto','benvenuta','amore','segreto','utente','ospite','admin','qwerty','sicurezza',

  // =========================
  // Months / Days (multi-idioma, sin tildes)
  // =========================
  'january','february','march','april','may','june','july','august','september','october','november','december',
  'enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre',
  'jan','feb','mar','apr','jun','jul','aug','sep','oct','nov','dec',
  'lunes','martes','miercoles','jueves','viernes','sabado','domingo',
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'lun','mar','mie','jue','vie','sab','dom',

  // =========================
  // Colors (en/ es / fr / de / it)
  // =========================
  'red','blue','green','black','white','yellow','purple','orange','pink','brown','gray','grey',
  'rojo','azul','verde','negro','blanco','amarillo','morado','naranja','rosa','marron','gris',
  'rouge','bleu','vert','noir','blanc','jaune','orange','rose','gris',
  'rot','blau','grun','schwarz','weiss','gelb','rosa','grau','braun',
  'rosso','blu','verde','nero','bianco','giallo','arancione','rosa','grigio','marrone',

  // =========================
  // Family / relationships
  // =========================
  'mother','mom','mum','father','dad','daddy','mama','papa','abuelita','abuela','abuelo','hermano','hermana',
  'brother','sister','son','daughter','baby','bebe','novia','novio','wife','husband','family','familia',
  'amigo','amiga','friends','bestfriend','mejoramigo','mejoramiga','team','equipo',

  // =========================
  // Animals (comunes)
  // =========================
  'dog','cat','bird','fish','lion','tiger','bear','wolf','eagle','shark','horse',
  'perro','gato','pajaro','pez','leon','tigre','oso','lobo','aguila','tiburon','caballo',

  // =========================
  // Foods / drinks
  // =========================
  'pizza','burger','taco','pasta','sushi','coffee','tea','beer','vodka','whiskey','wine',
  'cafe','cerveza','vino','agua','pan','arroz','pollo','carne','pescado','tortilla',

  // =========================
  // Tech brands & services
  // =========================
  'google','gmail','youtube','facebook','instagram','tiktok','twitter','x','linkedin','snapchat','whatsapp','telegram','discord',
  'microsoft','windows','office','outlook','skype','onedrive','azure',
  'apple','icloud','iphone','ipad','mac','macos','imac','airpods',
  'amazon','aws','prime','netflix','hbo','disney','spotify','steam','epic','twitch','github','gitlab','bitbucket',
  'binance','coinbase','kraken','metamask','ledger','trezor','crypto','bitcoin','ethereum','solana','polkadot','cardano',
  // ISPs / routers / SSID tipicos
  'adminrouter','router','modem','wifi','wifix','wifipassword','wifipass','internet','default','12345678','qwertyuiop',
  'movistar','vodafone','orange','jazztel','yoigo','euskaltel','ono','verizon','att','comcast','xfinity','spectrum','tplink','dlink','huawei','zyxel','netgear',

  // =========================
  // Operating systems / roles
  // =========================
  'ubuntu','debian','linux','windows','mac','android','ios','chrome','chromebook',
  'root','sudo','sysadmin','dev','devops','support','guest','operator','operator1','service','services',

  // =========================
  // Pop culture (genericos)
  // =========================
  'harrypotter','starwars','marvel','avengers','spiderman','superman','batman','onepiece','naruto','dragonball','pokemon','lol','valorant','fortnite','minecraft','gta','gta5',

  // =========================
  // Cities / countries (muy comunes)
  // =========================
  'spain','espana','france','francia','germany','alemania','italy','italia','portugal','mexico','usa','estadosunidos','argentina','brasil','brasilia','peru','chile',
  'madrid','barcelona','valencia','sevilla','bilbao','malaga','zaragoza','vigo','lisboa','porto','paris','londres','london','berlin','rome','roma','milano','newyork','miami','losangeles','tokyo',

  // =========================
  // Profanity / rude (frecuentes en contraseñas)
  // =========================
  'fuck','fucker','fuckyou','shit','bitch','bastard','asshole','dick','pussy',
  'mierda','joder','cabron','puta','puto','gilipollas',
  'merde','putain','scheisse','stronzo',

  // =========================
  // Names (muy comunes, subset pequeno)
  // =========================
  'maria','sofia','lucia','carmen','ana','laura','paula','martina','andrea','noa',
  'juan','carlos','jose','luis','javier','david','daniel','pablo','alejandro','miguel',
  'john','michael','david','james','robert','william','mary','jennifer','linda','jessica',
  'marie','jean','pierre','luc','paul','laurent','julie','sophie',
  'hans','peter','thomas','anna','lena','mia',
  'giovanni','marco','luca','andrea','francesco','mario',
  'joao','carlos','pedro','luis','rafael','ana','maria',

  // =========================
  // Years / dates / hints (raices)
  // =========================
  'year','anio','ano','birthday','cumple','cumpleanos','born','nacimiento','fecha','fecha123','ddmmyy','mmddyy','yyyymmdd',

  // =========================
  // Security / auth terms
  // =========================
  'token','totp','otp','2fa','mfa','factor','auth','authcode','security','secure','seguro','pin','nip','code','codigo','pass','passcode','key','keypass','master','vault','safe','lock','unlock',

  // =========================
  // Work / edu
  // =========================
  'trabajo','empleo','curriculum','cv','resume','job','jobs','work','worker','boss','boss1','team','teams','project','projects',
  'school','college','university','uni','campus','student','teacher','profesor','alumno',

  // =========================
  // Short roots commonly extended
  // =========================
  'adm','admin','usr','user','pwd','pass','abc','abcd','abcde','qwer','asdfg','zxcvb','qaz','wsx',
  'home','house','casa','c0d3','code','coder','dev','rooted','godmode','super',
  // Sufijos/prefijos tipicos con signos (solo raices)
  'admin@','admin#','admin$','root@','root#','root$','user@','user#','user$','pass@','pass#','pass$',

  // =========================
  // Company / generic domains (raices)
  // =========================
  'company','compania','empresa','service','services','support','help','helpdesk','desk','it','hr','sales','marketing','finance','billing','payments','payment','invoice','factura','facturacion',

  // =========================
  // Misc muy frecuentes
  // =========================
  'abc123','abcdef','abcdefg','abcxyz','xyz','xyz123',
  'iloveu','loveme','onlyyou','foreverlove',
  'myself','mypc','myphone','myemail','mywifi',
  'qwertyui','poiuytrewq','mnbvcxz',
  'yes','no','ok','okay','okay123','okayok','okok','okokok',
  'one','two','three','four','five','six','seven','eight','nine','ten',
  'uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
];
