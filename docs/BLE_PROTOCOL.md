# 网页 BLE 对接协议 0.1

状态：网页已按本草案实现；ESP32 与 FPGA 尚未联调。此处定义网页与 ESP32 之间的 BLE 应用层，不能据此声称现有 MIDI 固件已经支持下载。

ESP32 始终是转发代理，不拥有曲库。控制消息采用有界 UTF-8 JSON，便于网页和 ESP32 软件解析；DATA 使用二进制。ESP32 后续应将控制字段映射成 FPGA 约定的 UART 二进制命令，不要求 FPGA 实现 JSON 解析器。共享的是字段语义、序号/校验约定和文件字节，不要求 BLE 控制载荷逐字节照搬 UART。该转换只需小缓冲，不缓存整首曲目。

## GATT

- Service：`e6340001-8d7a-4e31-9ab0-43c800000001`
- RX（网页写 ESP32，Write With Response）：`e6340002-8d7a-4e31-9ab0-43c800000001`
- TX（ESP32 通知网页，Notify）：`e6340003-8d7a-4e31-9ab0-43c800000001`
- 广播必须包含 Service UUID，网页通过它过滤设备。
- 以上为项目自定义 UUID，固件必须一致；不是 BLE MIDI 或标准串口服务。
- 先按20字节拆分GATT写入。GET_CAPS成功后按返回的max_write拆分；ESP32根据已协商ATT MTU与自身容量计算此值。

一次GATT写/通知只是帧片段，帧允许跨多个特征值操作。应用DATA块确认必须来自FPGA；GATT写响应不是存储确认。网页一次只有一个在途应用请求，不能在其结束前发送下一条请求。

## 应用帧

`A5 5A | version:u8=1 | type:u8 | session:u32 | seq:u32 | payload_len:u16 | reserved:u16=0 | payload | crc32:u32`

整数小端，payload最多1024字节。CRC-32/ISO-HDLC覆盖version至payload末尾，反射多项式EDB88320、初值FFFFFFFF、最终异或FFFFFFFF；123456789得到CBF43926。应用会话由网页随机生成非零u32 session；每条新请求seq递增，重试保持相同session/seq/内容。响应回显session和seq。

ACK type=128，ERROR type=255，响应payload都是UTF-8 JSON。设备必须使重复BEGIN/DATA/COMMIT/DELETE幂等，并缓存最近响应用于重发。成功响应损失后重试不能重复写入或重复删除。断连使会话失效；未提交传输可在超时后清理，不能发布为可用曲目。

网页在完整发送请求后等待响应，通常5秒，COMMIT为30秒；超时最多重试两次，合计三次。错误响应不自动重试。若后端需要更长提交时间，应协调修改版本或超时约定。任意损坏帧都需长度上限及接收超时重同步，接收端不得无限积累字节。

## 命令与响应

下表中的JSON是载荷示例，不包括外层帧。

| type | 命令       | 请求                                                                                          | ACK                                                                                                                            |
| ---: | ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
|    1 | GET_CAPS   | 空                                                                                            | `{"protocol":1,"package_major":1,"max_payload":1024,"max_write":20,"max_file_bytes":4194304,"max_notes":20000,"profiles":[1]}` |
|    2 | GET_STATUS | 空                                                                                            | `{"state":"LIBRARY","free_bytes":8388608}`                                                                                     |
|    3 | LIST       | `{"cursor":null}`；后续带generation与cursor                                                   | `{"generation":1,"next":null,"items":[]}`                                                                                      |
|   16 | BEGIN      | `{"id":"UUID","revision":1,"title":"曲名","total_bytes":115820,"crc32":123,"capabilities":7}` | `{"next_offset":0}`                                                                                                            |
|   17 | DATA       | `offset:u32`加二进制文件数据，数据最多1020字节                                                | `{"next_offset":1020}`                                                                                                         |
|   18 | COMMIT     | 空                                                                                            | `{"state":"STORED","id":"UUID","revision":1,"crc32":123}`                                                                      |
|   19 | CANCEL     | 空                                                                                            | `{"state":"LIBRARY"}`                                                                                                          |
|   20 | DELETE     | `{"id":"UUID","revision":1}`                                                                  | `{"deleted":true}`                                                                                                             |

目录每项：`{"id":"UUID","revision":1,"title":"曲名","bytes":115820,"capabilities":7}`。一个响应必须装进1024字节；不能因请求允许32条而返回超长JSON，实际每页数量按编码字节数限制。generation在曲库变化后增加，游标为有界字符串或null；网页发现generation变化会要求刷新，不混合目录版本。

ERROR示例：`{"code":"NO_SPACE","message":"空间不足"}`。建议支持BUSY、NO_SPACE、UNSUPPORTED_VERSION、UNSUPPORTED_PROFILE、BAD_FRAME_CRC、BAD_FILE_CRC、BAD_OFFSET、BAD_PACKAGE、STORAGE_ERROR。

state支持LIBRARY、IMPORTING、READING、PERFORMING。BEGIN与DELETE只在LIBRARY允许，FPGA执行端再次核验，不能只依赖网页禁用按钮。导入中不允许开始演奏。网页不会遥控演奏或代替FPGA计分。

DATA ACK表示FPGA已接受该块，COMMIT STORED表示整首校验通过且满足约定的保存语义。目录、容量与最终状态都来自FPGA，ESP32不能自行伪造STORED。COMMIT响应丢失时结果可能不确定，网页提示刷新曲库核对，不能把超时解释为肯定未写入。

## 曲目格式与谱面规格

使用PSC1 1.0、64字节头、32字节分段目录、16字节NOTE记录；源代码 `src/lib/pseq.ts` 是网页只读校验器。文件布局详见 `PSEQ_FORMAT.md`。样本profile=1明确为960×480、MONO1、每行最高位在左，1黑0白；FPGA未支持该profile时拒绝发送，不能默认任意屏幕都已兼容。

首版BLE联调先确认GATT发现、20字节碎片重组、CRC、GET_CAPS和GET_STATUS，再做小文件BEGIN/DATA/COMMIT。最后验证断线、重复块、容量不足、忙状态和删除。演奏期间无线关闭的实时验收独立于这些曲目管理测试。
