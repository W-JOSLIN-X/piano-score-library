# 曲目包与传输接口草案

网页实现对照说明：本文保留团队的曲目包和UART方案草案。当前网页实际使用的BLE命令编号、UUID和控制载荷见同目录BLE_PROTOCOL.md；BLE控制JSON由ESP32软件解析再映射到FPGA二进制命令，不要求FPGA实现JSON。样本profile 1已在网页侧定义为960×480 MONO1，仍须FPGA声明支持后才能传输。

本接口用于网页经 BLE、ESP32 经 UART 向 FPGA 侧曲库存入预制曲目。现有 SPI 六字节实时演奏帧继续使用，不附加曲目文件内容。ESP32 为有界缓冲代理，FPGA 是目录、空间、存储结果和运行状态的最终权威。

状态：v0.1 对接草案，供两位开发者共同冻结；下列文件布局给出可实现的基线，UART 命令编号及各命令载荷还需落入共享头文件、编解码器与测试向量后才是冻结版。不要根据描述分别猜测实现。

## 曲目包约定

扩展名 .pseq，整数小端、无编译器隐式填充；用显式字节读写，不发送 C 结构体内存。UUID属于字节数组：标准字符串去掉连字符后，每两位十六进制从左到右对应一个字节，不使用Windows GUID结构体的混合端序。文件由64字节头、32字节目录项、4字节对齐的数据段构成；填充字节为0。包按曲目 ID 与 revision 标识内容，不以文件名区分版本。

文件头布局：

| 偏移 | 长度 | 字段             | 含义                                                |
| ---: | ---: | ---------------- | --------------------------------------------------- |
|    0 |    4 | magic            | ASCII PSC1                                          |
|    4 |    2 | major            | 1；不支持时拒绝                                     |
|    6 |    2 | minor            | 0                                                   |
|    8 |    4 | total_bytes      | 包含头和填充的总字节数                              |
|   12 |   16 | song_id          | 原始16字节 UUID，与目录中的标准 UUID 字符串转换一致 |
|   28 |    4 | revision         | 曲目内容版本                                        |
|   32 |    4 | duration_ms      | 展开后的原速曲目时长                                |
|   36 |    2 | section_count    | 目录项数                                            |
|   38 |    2 | header_bytes     | 64                                                  |
|   40 |    4 | directory_offset | 首版64                                              |
|   44 |    4 | capabilities     | bit0演奏、bit1五线谱、bit2简谱；其他位0             |
|   48 |    4 | note_count       | NOTE段总记录数                                      |
|   52 |   12 | reserved         | 全0                                                 |

目录项布局：type:u32、profile:u16、flags:u16、offset:u32、length:u32、count:u32、record_bytes:u16、reserved:u16、crc32:u32、reserved2:u32，共32字节。offset为文件绝对字节偏移；length不含段尾对齐填充；CRC只覆盖本段的length字节；reserved字段为0。flags bit0=必须理解，否则可跳过未知段。未知必需段拒绝装载，未知可选段按边界跳过。

| type | 名称   | 内容                                     | 是否必须                                       |
| ---: | ------ | ---------------------------------------- | ---------------------------------------------- |
|    1 | META   | 标题等 UTF-8 元数据，由网页/软件工具读取 | 是；FPGA可用UART元数据建立目录，不要求解析JSON |
|    2 | NOTE   | 16字节参考音符记录                       | 演奏模式必须                                   |
|    3 | CC     | 8字节控制事件记录                        | 可选                                           |
|    4 | BEAT   | 8字节拍点记录                            | 可选，供节拍线和倒数                           |
|    5 | PAGE   | 24字节谱面页描述符                       | 对应阅读模式必须                               |
|    6 | BITMAP | PAGE引用的单色像素资源                   | 对应阅读模式必须                               |
|    7 | ANCHOR | 24字节时间到小节位置索引                 | 自动跟踪/翻页可选                              |

首版NOTE至多一个，profile=0，为所有显示规格共享。每个非零profile代表制作工具与FPGA共同支持的资源规格；PAGE/BITMAP可按profile多组存在。首版宜每包仅包含一种谱面规格，减少下载大小；网页根据能力选择匹配的变体。相同song_id/revision的变体必须具有完全相同的NOTE/CC语义。profile标识不能由两边独立分配，须共享静态规格表。

META采用UTF-8 JSON供软件使用，至少title、source、generator_version。目录传输另提供有长度上限的标题字段；FPGA可以先显示编号或由其UI实现字体，不默认FPGA已具备完整中文字库。若需要标题位图，在后续明确资源段，不能把UTF-8字节直接当像素。

## 音符和控制记录

NOTE按start_ms、pitch、group_id稳定排序；note_id是段内从0开始的记录序号，同一revision中稳定。每次用户击键最多消耗一个可评分记录，每条记录最多结算一次。

| 偏移 | 类型 | 字段        | 语义                                        |
| ---: | ---- | ----------- | ------------------------------------------- |
|    0 | u32  | start_ms    | 展开后曲目原速时间                          |
|    4 | u32  | duration_ms | 按键持续时长，非踏板声学延长时长            |
|    8 | u8   | pitch       | 0～127                                      |
|    9 | u8   | velocity    | 1～127                                      |
|   10 | u8   | hand_mask   | 0未知、1左、2右、3双手同音合并              |
|   11 | u8   | flags       | bit0=参与判分，其他位0                      |
|   12 | u32  | group_id    | 同一起点的和弦/击键组，同组start_ms必须一致 |

示例：2000ms开始、持续500ms、音符60、力度100、右手、参与判分、组7：

```text
D0 07 00 00 F4 01 00 00 3C 64 02 01 07 00 00 00
```

制作工具合并延音线，展开反复，并验证非零持续时长、音高/力度范围、时间溢出、记录数及最大重叠数。不得把同一音符的Note On和Note Off分别算成两个判分目标。小于1ms等无法用当前单位无损表示的内容必须报告量化处理，不静默截断。

CC每条8字节：time_ms:u32、route:u8、controller:u8、value:u8、reserved:u8。route高四位为参考cable低四位为channel；controller/value 0～127。该段描述参考控制信息，不自动转为实时音源控制，也不默认参与首版判分。

BEAT每条8字节：time_ms:u32、measure_index:u16、beat_index:u8、flags:u8；拍号变化已在预处理中体现，首版flags bit0表示小节起点。支持的最大小节数由字段范围约束。

## 五线谱与简谱资源

PAGE每条24字节：page_id:u32、profile:u16、notation:u8、format:u8、width:u16、height:u16、stride:u16、reserved:u16、data_offset:u32、data_length:u32。notation=1五线谱、2简谱；format=1为单色1bpp；page_id在整个包中唯一。data_offset为文件绝对偏移，必须落在匹配profile的BITMAP段内。

像素从左上角开始、逐行存储；每字节最高位对应最左像素，1为黑、0为白；stride=ceil(width/8)，data_length=stride×height；每行末尾未使用位为0。首版不压缩，不要求FPGA解PNG/JPEG/SVG，不在ESP32上解压整页。网站预览图可用PNG，但下载包的像素段必须符合上述布局。

两种记谱模式分别存完整页，不能把五线谱图片作为简谱。第一版阅读允许手动翻页；自动翻页有ANCHOR才启用。首版固定排版，运行时移调或任意缩放后的重新排版不在支持范围内。

ANCHOR每条24字节：time_ms:u32、page_id:u32、measure_index:u32、x:u16、y:u16、width:u16、height:u16、notation:u8、reserved[3]。用于指示当前小节区域；不承诺逐音符高亮。反复展开时，同一页/小节可以对应多个时间点，不能假设页码随时间单调增加。

FPGA必须报告接受的profile与最大页尺寸。外部团队可以先用软件模拟的1280×720单色profile生成样本；实际发布给硬件的包必须匹配双方冻结的profile，不能把样本规格当作板卡能力。

## 文件校验与模式可用性

目录不允许越界、相互重叠或与头/目录重叠；使用足够宽的算术检查offset+length、count×record_bytes与像素容量。固定记录段的count×record_bytes必须等于length。页面ID、ANCHOR引用和记录数量必须一致。模式标志必须有完整资源支撑，缺失时报错或明确禁用该模式。

整文件CRC32放在网站catalog和BEGIN请求中，覆盖文件全部total_bytes字节，包括头、目录、填充。CRC采用CRC-32/ISO-HDLC：反射多项式0xEDB88320、初值0xFFFFFFFF、最终异或0xFFFFFFFF，结果以小端传输；ASCII“123456789”的结果为0xCBF43926。分段CRC和传输帧CRC使用相同算法。CRC检测传输错误，不承担身份认证。

## UART 帧与分块转发

独立双向UART，初拟1 Mbaud、8N1，共地、兼容3.3V IO。UART0仍用于CH340日志，曲目走UART1。具体GPIO由接线表冻结。每条帧为以下结构：

```text
A5 5A | version:u8 | type:u8 | session:u32 | seq:u32 |
payload_len:u16 | reserved:u16 | payload:N | crc32:u32
```

固定开销20字节，payload_len首版不超过1024，reserved=0，version=1。CRC覆盖从version到payload末字节，不含同步字节和CRC自身。所有整数小端。type和命令载荷定义应由共享头文件统一生成。

接收状态机有最大长度与帧超时。同步字节可能出现在payload内，已接受合法长度后不在payload中找新帧头；校验/长度失败进入重同步并丢弃当前帧，必须用丢字节/插字节测试验证恢复。CRC保护的定界不等于实时SPI的CS定界。

首版一次仅一条未完成请求。响应回显session/seq；同一请求重试不重复写入或删除。DATA含offset:u32与最多1020字节文件数据，FPGA确认next_offset；只接受期望偏移或已确认重复块，不能跳过缺失字节。首版超时重试次数有界，例如最多3次，耗尽后失败并由用户重启传输。超时值通过能力/命令类别区分，不能让可能耗时的存储提交与普通DATA共用过短超时。

ESP32以固定缓冲接收和转发，不在GATT回调中阻塞等待ACK。网页应用帧可复用该封装，按GATT单次最大写入长度拆分；一次BLE写不是一个完整应用帧。

## 命令和端到端状态

| 命令         | 请求/结果                                                                   | 最终处理者        |
| ------------ | --------------------------------------------------------------------------- | ----------------- |
| GET_CAPS     | 协议/包版本、支持的profile、最大包/曲目/音符/重叠数、块长和超时             | FPGA              |
| GET_STATUS   | 管理/导入/阅读/演奏/错误状态、剩余空间                                      | FPGA              |
| LIST         | generation、游标、有限条数目录；song_id、revision、模式、大小、标题         | FPGA              |
| BEGIN        | song_id、revision、profile、total_bytes、整文件CRC，分配session与期望offset | FPGA              |
| DATA         | offset与文件字节；ACK返回next_offset                                        | FPGA              |
| COMMIT       | 校验完整文件、结构、保存并发布目录项；返回STORED                            | FPGA              |
| CANCEL       | 结束当前传输，丢弃未提交内容                                                | FPGA              |
| DELETE       | 删除指定ID/版本；仅管理状态                                                 | FPGA              |
| RESULT/ERROR | 返回原请求结果或错误码                                                      | FPGA，经ESP32转达 |

建议错误码：BUSY、NO_SPACE、UNSUPPORTED_VERSION、UNSUPPORTED_PROFILE、BAD_FRAME_CRC、BAD_FILE_CRC、BAD_OFFSET、BAD_PACKAGE、STORAGE_ERROR、TIMEOUT。ESP32链路错误与FPGA存储错误必须区分显示，不能全部报“蓝牙失败”。

FPGA在BEGIN/DELETE/COMMIT等命令执行点验证工作状态和目标版本。网页与ESP32观察到的状态可能已过时，不能替代执行点校验。实际状态由FPGA本地UI与其状态机维护；网页不以收到普通ACK推断正在演奏或停止。

FPGA的DATA ACK表示数据已接收进其可靠管理的导入流程，不必意味着每块已完成物理非易失写入；COMMIT的STORED才表示整首完成并满足断电保存约定。断线/断电后半文件不可出现在可用目录。首版可放弃未提交传输并重新下载。若断电保留不在FPGA版本范围内，则必须返回不同的易失保存能力，网页不得标成“已永久保存”。

## 与演奏事件的关系

实时SPI协议保持原6字节结构。FPGA在完整帧接收时记录本地时间，与本地曲目时钟比较。USB→SPI桥接有延迟，判定窗口需要校准偏移；当前协议没有琴内时间戳，无法还原琴键物理触发的精确时刻。

参考表是待演奏目标，SPI是实际演奏；导入曲目不能自动向音源注入所有参考音符。演奏成绩、Combo、Miss由FPGA生成。首版无需ESP32逐音符发送动画指令；如未来要网页展示成绩，可增加带session的低频成绩查询，不侵占实时事件通道。

## 联调交付物

双方冻结接口时共同提交：枚举值与共享头文件、包编码器与只读校验器、UART编解码器、二进制黄金样本、十六进制抓包样例、FPGA能力清单、错误与断线测试脚本。对同一包同时比较网站预览、电脑模拟器输出、UART字节和FPGA目录内容。
