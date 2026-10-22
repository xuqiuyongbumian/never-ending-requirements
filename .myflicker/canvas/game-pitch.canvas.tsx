// skills: canvas
import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Text
} from "codeflicker/canvas";

export default function GamePitchCanvas() {
  return (
    <Stack gap={24}>
      <Stack gap={4}>
        <H1>需求永不眠：1024 极限上线</H1>
        <Text tone="secondary">赶工完成 ddl 的横版策略游戏 · 5 分钟倒计时送项目上线</Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="05:00" label="倒计时内完成大需求、把项目送上线" />
        <Stat value="三选二" label="交付速度 / 技术升级 / 项目稳定" />
        <Stat value="债换快" label="想快就得拿技术债去换，债多线上崩" tone="warning" />
        <Stat value="AI 贷款" label="快是要付利息的，AI 不是外挂" tone="info" />
      </Grid>

      <Stack gap={8}>
        <Row gap={8} align="center">
          <Pill active tone="warning">
            新意在机制
          </Pill>
          <Text weight="semibold">把「需求快交付」从稳赚变成一笔贷款</Text>
        </Row>
        <Text>
          你越顺、越想快，越要提前想好这笔账。每一次加速都记着，不当场罚你；等债务飙到红线，游戏触发「AI
          已被安全部门封禁」、全队效率减半，你只能回头补测试和架构师。
        </Text>
      </Stack>

      <Divider />

      <Stack gap={12}>
        <H2>游戏是从「deadline」切入的</H2>
        <Text tone="secondary">
          左边是研发中心，右边需求一波波涌进来，工程师自己走过去处理，你只负责招人、花预算、在关键节点做决定。
        </Text>
        <Text tone="secondary">
          它还原的是做项目最后那几天最真实的瞬间：评审会开完需求又改、老板说「就改个按钮」就加三个需求、CI
          半夜挂了、AI 写得飞快但没人敢看。
        </Text>
      </Stack>

      <Divider />

      <Stack gap={12}>
        <H2>零美术零音效，美术与音乐全靠 AI 探索</H2>
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>配乐：零素材</CardHeader>
            <CardBody>
              <Stack gap={8}>
                <Text>Web Audio 实时合成，工程音频体积为零，无第三方授权。</Text>
                <Text>一首曲子、三套编制：手搓时代单薄方波，工程化时代低音律动，Agent 时代密集琶音。</Text>
                <Text>时代切换无缝，冲刺、故障、最后 30 秒各有变化——状态全靠音乐讲。</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>美术：四步管线</CardHeader>
            <CardBody>
              <Stack gap={8}>
                <Text>定规格再生图 → 以立绘为基准图生图 → 脚本清洗归一 → 人工验收。</Text>
                <Text>
                  第一版角色撞脸分不清，改成以各自立绘重新生成；生成图不齐，脚本统一裁切、缩放、对齐、清杂点。
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Divider />

      <Stack gap={12}>
        <H2>行为数据：看得见每一局</H2>
        <Grid columns={2} gap={12}>
          <Stack gap={6}>
            <Text weight="semibold">两条底线</Text>
            <Text tone="secondary">不打扰：记录不拖慢游戏，断网不丢，本地暂存、有网再传。</Text>
            <Text tone="secondary">不窥探：只收匿名身份，分数服务端重算，改数据刷不了榜。</Text>
          </Stack>
          <Stack gap={6}>
            <Text weight="semibold">分析台</Text>
            <Text tone="secondary">回放单局时间线、统计决策与冲刺节奏，成就由历史对局直接推导。</Text>
          </Stack>
        </Grid>
      </Stack>

      <Divider />

      <Text weight="semibold">游戏结束的那一刻，我们对玩家的理解才算真正开始。</Text>
    </Stack>
  );
}
