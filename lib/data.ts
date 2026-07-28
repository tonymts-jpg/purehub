import { CreatorProfile, Notification, Post, Product, Transaction } from "./types";

const galleryAlts = [
  "主视觉人物肖像", "角色全身造型", "环境氛围画面", "人物侧面构图",
  "场景互动瞬间", "服装造型特写", "创作过程记录", "自然神态近景",
  "道具与材质细节", "幕后准备画面", "人物情绪特写", "作品收尾画面"
];

const createPostMedia = (postId:string, title:string) =>
  galleryAlts.map((description,index)=>({
    id:`${postId}-media-${index+1}`,
    src:`/generated/posts/${postId}/${String(index+1).padStart(2,"0")}.webp`,
    alt:`${title} — ${description}`,
    width:720,
    height:900,
    order:index+1,
    kind:"image" as const
  }));

export const creators: CreatorProfile[] = [
  { id:"c1", name:"林夕 Yuki", handle:"yuki", avatar:"夕", role:"creator", bio:"Cosplay 造型师与角色摄影博主，分享服装制作、妆造细节与完整主题企划。", category:"Cosplay", followers:128400, members:2438, cover:"cover-1", verified:true, plans:[
    {id:"p11",name:"旅人",price:18,color:"#ff7b75",benefits:["每周高清套图","造型制作动态","会员徽章"]},
    {id:"p12",name:"造梦者",price:48,color:"#a865d7",benefits:["包含旅人权益","幕后花絮","每月直播"]},
    {id:"p13",name:"星图收藏家",price:98,color:"#6559df",benefits:["全部权益","限定主题企划","作品署名鸣谢"]}
  ]},
  { id:"c2", name:"陈默", handle:"chenmo", avatar:"默", role:"creator", bio:"专注鞋履、美足与生活方式摄影，用光影记录优雅线条和细腻质感。", category:"美足", followers:86500, members:1280, cover:"cover-2", verified:true, plans:[
    {id:"p21",name:"观景席",price:15,color:"#ff7b75",benefits:["无水印套图","布光笔记"]},
    {id:"p22",name:"暗房会员",price:42,color:"#a865d7",benefits:["调色预设","幕后花絮","月度直播"]},
    {id:"p23",name:"城市合伙人",price:88,color:"#6559df",benefits:["全部权益","限定写真集","线下活动优先"]}
  ]},
  { id:"c3", name:"Momo Studio", handle:"momo", avatar:"M", role:"creator", bio:"以角色关系、情境演绎与戏剧化叙事为核心的成人向主题工作室。", category:"調教", followers:74200, members:937, cover:"cover-3", verified:true, plans:[
    {id:"p31",name:"旁观席",price:12,color:"#ff7b75",benefits:["主题预告","角色设定"]},
    {id:"p32",name:"幕后通行证",price:39,color:"#a865d7",benefits:["情境脚本","制作日志","主题投票"]},
    {id:"p33",name:"联合策划人",price:108,color:"#6559df",benefits:["全部权益","企划署名","限量周边"]}
  ]},
  { id:"c4", name:"空山映像", handle:"kongshan", avatar:"山", role:"creator", bio:"在山野、海岸与城市边缘完成自然光人像和旅行主题创作。", category:"戶外", followers:45900, members:682, cover:"cover-4", verified:true, plans:[] },
  { id:"c5", name:"六月私语", handle:"june", avatar:"六", role:"creator", bio:"面向成年观众的私密美学、情绪写真与创作手记。", category:"R18", followers:39200, members:510, cover:"cover-5", verified:false, plans:[
    {id:"p51",name:"夜读者",price:20,color:"#ff7b75",benefits:["每周成熟主题预览","会员徽章","创作手记"]},
    {id:"p52",name:"私语会员",price:56,color:"#a865d7",benefits:["完整高清图集","幕后手记","主题投票"]},
    {id:"p53",name:"深夜收藏家",price:118,color:"#6559df",benefits:["全部权益","限定企划","作品署名鸣谢"]}
  ] },
  { id:"c6", name:"角色造梦局", handle:"gameclub", avatar:"梦", role:"creator", bio:"从游戏、电影与原创设定中还原角色，记录每次变身的完整过程。", category:"Cosplay", followers:92100, members:1560, cover:"cover-6", verified:true, plans:[] },
  { id:"c7", name:"黑曜 Nora", handle:"nora", avatar:"曜", role:"creator", bio:"成熟暗黑时尚与安全边界主题博主，擅长皮革、绳结与高反差棚拍叙事。", category:"SM", followers:68800, members:1120, cover:"cover-3", verified:true, plans:[
    {id:"p71",name:"观察席",price:22,color:"#ff7b75",benefits:["主题预览","安全边界手记","会员徽章"]},
    {id:"p72",name:"暗场会员",price:58,color:"#a865d7",benefits:["完整高清图集","布光与造型拆解","主题投票"]},
    {id:"p73",name:"黑曜收藏家",price:128,color:"#6559df",benefits:["全部权益","限定棚拍企划","作品署名鸣谢"]}
  ]},
  { id:"c8", name:"缎面 Ivy", handle:"ivy", avatar:"缎", role:"creator", bio:"以成熟女性力量、缎面服装与戏剧化情绪为核心的非露骨 SM 美学博主。", category:"SM", followers:53600, members:860, cover:"cover-5", verified:true, plans:[
    {id:"p81",name:"缎面读者",price:19,color:"#ff7b75",benefits:["每周精选预览","造型清单","会员徽章"]},
    {id:"p82",name:"私享会员",price:52,color:"#a865d7",benefits:["完整图集","幕后手记","月度主题投票"]},
    {id:"p83",name:"舞台合伙人",price:116,color:"#6559df",benefits:["全部权益","限定企划","作品署名"]}
  ]},
  { id:"c9", name:"陆沉 Kai", handle:"kai", avatar:"K", role:"creator", bio:"男性暗黑绅士风与张力人像博主，关注安全、礼仪、服装和摄影现场控制。", category:"SM", followers:49700, members:740, cover:"cover-6", verified:false, plans:[
    {id:"p91",name:"旁听席",price:16,color:"#ff7b75",benefits:["主题预告","穿搭笔记"]},
    {id:"p92",name:"黑领会员",price:46,color:"#a865d7",benefits:["完整图集","现场流程","幕后花絮"]},
    {id:"p93",name:"绅士档案",price:98,color:"#6559df",benefits:["全部权益","限定外拍","企划署名"]}
  ]},
  { id:"c10", name:"沈越", handle:"shenyue", avatar:"越", role:"creator", bio:"男帅时尚人像博主，擅长城市夜景、西装造型与干净利落的镜头语言。", category:"男帥", followers:101200, members:1700, cover:"cover-2", verified:true, plans:[
    {id:"p101",name:"街角席",price:18,color:"#ff7b75",benefits:["每周精选","穿搭清单","会员徽章"]},
    {id:"p102",name:"城市会员",price:49,color:"#a865d7",benefits:["完整高清图集","调色预设","幕后花絮"]},
    {id:"p103",name:"黑卡收藏",price:108,color:"#6559df",benefits:["全部权益","限定外拍","作品署名鸣谢"]}
  ]},
  { id:"c11", name:"顾野", handle:"guye", avatar:"野", role:"creator", bio:"运动型男与户外男性写真博主，记录力量训练、山野外拍与自然光肖像。", category:"男帥", followers:83400, members:1320, cover:"cover-4", verified:true, plans:[
    {id:"p111",name:"训练席",price:20,color:"#ff7b75",benefits:["训练主题预览","器材清单"]},
    {id:"p112",name:"山野会员",price:54,color:"#a865d7",benefits:["完整图集","外拍路线","幕后记录"]},
    {id:"p113",name:"峰顶收藏",price:118,color:"#6559df",benefits:["全部权益","限定日出企划","作品署名"]}
  ]},
  { id:"c12", name:"韩序", handle:"hanxu", avatar:"序", role:"creator", bio:"清冷电影感男性肖像博主，偏爱简约空间、白衬衫、低饱和色调与叙事光影。", category:"男帥", followers:76800, members:1190, cover:"cover-1", verified:true, plans:[
    {id:"p121",name:"观影席",price:17,color:"#ff7b75",benefits:["每周预览","镜头笔记"]},
    {id:"p122",name:"叙事会员",price:45,color:"#a865d7",benefits:["完整图集","布光拆解","主题投票"]},
    {id:"p123",name:"片场收藏",price:96,color:"#6559df",benefits:["全部权益","限定短片企划","作品署名"]}
  ]}
];

const titles = [
  ["雾港巡游：完整造型公开","从服装打版到夜景拍摄，记录这套原创角色的诞生。","Cosplay"],
  ["缎面高跟鞋光影练习","用柔光呈现鞋履、足部线条与材质细节。","美足"],
  ["红丝绒房间：角色规则","会员限定的情境设定、角色关系与幕后手记。","調教"],
  ["雨后竹林写真日记","沿着山路寻找雾气、逆光与最自然的表情。","戶外"],
  ["午夜私语 Vol.01","仅面向成年观众的氛围写真与创作随笔。","R18"],
  ["机械姬妆造拆解","金属质感妆容、假发修剪与道具制作全过程。","Cosplay"],
  ["赤足与晨光","清晨窗边的自然光、美足姿态与构图练习。","美足"],
  ["主题企划：服从与反转","从服装、场景到表演节奏的完整企划说明。","調教"],
  ["海岸线的风","冬日海边外拍，记录风、浪与低饱和色彩。","戶外"],
  ["暗房来信 Vol.02","成年会员专属的私密主题预览与拍摄札记。","R18"],
  ["月面研究员 Cosplay","低重力温室角色设定与完整高清套图。","Cosplay"],
  ["黑色绑带鞋造型集","围绕鞋履与足部配饰完成的极简时尚主题。","美足"],
  ["黑白房间幕后记录","角色引导、灯光调度与安全边界的制作记录。","調教"],
  ["旧车站外拍计划","在废弃站台完成一组电影感旅行写真。","戶外"],
  ["深夜红光主题","R18 分级的成人美学企划与会员限定花絮。","R18"],
  ["狐面祭典造型册","和风角色服装、面具道具与夜间灯光测试。","Cosplay"],
  ["雨夜鞋履调色预设","一套针对霓虹街景与足部特写的调色方案。","美足"],
  ["山顶日出拍摄清单","器材、路线、天气判断与完整户外拍摄复盘。","戶外"]
] as const;

const basePosts: Post[] = titles.map((item, i) => ({
  id:`post-${i+1}`, creatorId:`c${i%6+1}`, title:item[0], excerpt:item[1],
  content:"这是完整作品内容的 Demo 展示。博主可以在这里分享高清图集、创作过程、源文件说明与会员专属幕后故事。PureHub 将内容、社群与可持续收入放在同一个体验里。",
  cover:`cover-${i%6+1}`, category:item[2], tags:[item[2],"精选",i%2?"幕后":"灵感"],
  visibility:i%5===3?"purchase":i%4===2?"members":"free", price:i%5===3?28:undefined,
  likes:860+i*137, comments:[{id:`cm-${i}`,user:"小北",text:"氛围和细节都太棒了，期待下一篇！",time:"2小时前"}],
  createdAt:i<2?"今天":i<7?"本周":"6月",
  media:createPostMedia(`post-${i+1}`,item[0])
}));

const extraPosts = [
  ["post-19","c7","黑曜棚拍：皮革边界","以成熟暗黑时尚语言记录皮革造型、手势张力与安全边界。","SM","free",undefined,3360,"今天"],
  ["post-20","c7","绳结光影练习","用低调棚灯呈现绳结纹理、服装层次与人物的冷静神态。","SM","members",undefined,3497,"今天"],
  ["post-21","c7","暗红幕布企划","黑曜 Nora 的暗红舞台主题，从布景到姿态引导完整记录。","SM","purchase",38,3634,"本周"],
  ["post-22","c8","缎面手套与高背椅","缎面服装、复古高背椅与成熟女性力量的情绪写真。","SM","free",undefined,3771,"今天"],
  ["post-23","c8","银灰束腰造型册","围绕束腰、手套与冷调空间完成的非露骨时尚主题。","SM","members",undefined,3908,"本周"],
  ["post-24","c8","午夜舞台排练","记录灯位、服装、肢体语言和安全沟通的幕后排练。","SM","purchase",32,4045,"本周"],
  ["post-25","c9","黑领绅士肖像","男性暗黑绅士风棚拍，强调礼仪、服装质感与克制张力。","SM","free",undefined,4182,"今天"],
  ["post-26","c9","金属手杖与影子","以手杖、风衣和硬光影子构成的成熟男性主题图集。","SM","members",undefined,4319,"本周"],
  ["post-27","c9","夜色指令板","用安全词卡、拍摄流程板和片场记录构建非露骨叙事。","SM","purchase",36,4456,"6月"],
  ["post-28","c10","雨夜西装街拍","城市霓虹、黑色西装与雨夜街角的男帅时尚外拍。","男帥","free",undefined,4593,"今天"],
  ["post-29","c10","天台风衣计划","高楼天台、长风衣与低角度镜头的冷峻男性肖像。","男帥","members",undefined,4730,"本周"],
  ["post-30","c10","黑白电梯间","极简黑白空间里完成的西装、腕表与眼神特写。","男帥","purchase",28,4867,"本周"],
  ["post-31","c11","山野训练日记","晨雾山路、运动外套与力量训练后的自然光肖像。","男帥","free",undefined,5004,"今天"],
  ["post-32","c11","岩壁与背包清单","户外男性写真与装备细节，从背包到登山鞋完整记录。","男帥","members",undefined,5141,"本周"],
  ["post-33","c11","日出冲刺复盘","山顶日出、汗水和风声中的运动型男拍摄复盘。","男帥","purchase",30,5278,"6月"],
  ["post-34","c12","白衬衫窗边光","低饱和室内光影、白衬衫与清冷男性肖像。","男帥","free",undefined,5415,"今天"],
  ["post-35","c12","旧影院座椅","复古影院、暗红座椅与电影感侧脸构图。","男帥","members",undefined,5552,"本周"],
  ["post-36","c12","蓝灰房间独白","蓝灰色房间、台灯与克制表情组成的叙事写真。","男帥","purchase",34,5689,"6月"]
] as const;

const extraPostRecords: Post[] = extraPosts.map((item,index)=>({
  id:item[0], creatorId:item[1], title:item[2], excerpt:item[3],
  content:"这是完整作品内容的 Demo 展示。博主可以在这里分享高清图集、创作过程、源文件说明与会员专属幕后故事。PureHub 将内容、社群与可持续收入放在同一个体验里。",
  cover:`cover-${index%6+1}`, category:item[4], tags:[item[4],"精选",index%2?"幕后":"灵感"],
  visibility:item[5], price:item[6],
  likes:item[7], comments:[{id:`cm-${item[0]}`,user:"阿澈",text:"质感和镜头节奏都很完整，收藏了。",time:"1小时前"}],
  createdAt:item[8],
  media:createPostMedia(item[0],item[2])
}));

export const posts: Post[] = [...basePosts, ...extraPostRecords];

export const products: Product[] = [
  {id:"pr1",creatorId:"c1",title:"《雾港巡游》4K 套图",price:36,cover:"cover-1"},
  {id:"pr2",creatorId:"c2",title:"鞋履写真调色预设",price:49,cover:"cover-2"},
  {id:"pr3",creatorId:"c3",title:"主题企划幕后手记",price:68,cover:"cover-3"}
];

export const transactions: Transaction[] = [
  {id:"t1",title:"造梦者会员收入",amount:48,type:"income",date:"今天 14:28",status:"已入账"},
  {id:"t2",title:"数字商品销售",amount:36,type:"income",date:"今天 11:05",status:"已入账"},
  {id:"t3",title:"旅人会员收入",amount:18,type:"income",date:"昨天",status:"待结算"},
  {id:"t4",title:"提现至支付宝",amount:-1200,type:"payout",date:"6月18日",status:"已完成"}
];

export const notifications: Notification[] = [
  {id:"n1",title:"你有一位新会员",body:"南风加入了「造梦者」会员。",time:"5分钟前",read:false,type:"member"},
  {id:"n2",title:"作品获得 100 个赞",body:"《雾港纪事》正在被更多人看见。",time:"1小时前",read:false,type:"like"},
  {id:"n3",title:"订阅续费成功",body:"你对林夕 Yuki 的支持已续费。",time:"昨天",read:true,type:"payment"},
  {id:"n4",title:"PureHub 博主周报",body:"本周收入较上周增长 18.4%。",time:"周一",read:true,type:"system"}
];

export const trendData = [
  {name:"4月",income:12800,members:1480},{name:"5月",income:16400,members:1760},
  {name:"6月",income:19380,members:2438}
];
