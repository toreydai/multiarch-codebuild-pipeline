# 架构说明

本项目按 AWS 博客的 Code Suite 方案实现多架构容器镜像构建流水线。源码进入 CodeCommit 后，由 CodePipeline 触发 CodeBuild，最终把 `linux/amd64` 和 `linux/arm64` 镜像以同一个 tag 推送到 Amazon ECR。

## 架构图

```text
Developer workstation
    |
    | git push
    v
AWS CodeCommit
    |
    v
AWS CodePipeline
    |
    v
AWS CodeBuild
    |
    | docker buildx build --platform linux/amd64,linux/arm64 --push
    v
Amazon ECR
    |
    v
Multi-architecture image manifest
```

## CDK 资源

CDK 入口在 `infra/main.ts`，部署后创建这些资源：

| 资源 | 作用 |
|---|---|
| `AWS::CodeCommit::Repository` | 流水线源码仓库 |
| `AWS::CodePipeline::Pipeline` | Source + Build 两阶段流水线 |
| `AWS::CodeBuild::Project` | privileged Docker 环境中执行 buildx 构建 |
| `AWS::ECR::Repository` | 保存多架构镜像和 manifest list |
| `AWS::S3::Bucket` | CodePipeline artifact bucket |
| `AWS::IAM::Role` / Policy | 允许流水线、构建和 ECR 推送 |

## 构建流程

`infra/buildspec.yml` 执行以下步骤：

1. 通过 STS 获取当前 AWS account。
2. 根据 region 判断 ECR 域名后缀：
   - 中国区：`amazonaws.com.cn`
   - 海外区：`amazonaws.com`
3. 登录当前账号的 ECR registry。
4. 从账号内 ECR 拉取 `binfmt` 镜像并注册，让 buildx 可以构建非本机架构镜像。
5. 从账号内 ECR 拉取 `buildkit` 镜像，创建并初始化 Docker buildx builder。
6. 执行：

```bash
docker buildx build \
  --platform "$PLATFORMS" \
  --build-arg "BASE_IMAGE=$BASE_IMAGE" \
  --tag "$IMAGE_URI" \
  --push app
```

默认 `PLATFORMS` 是：

```text
linux/amd64,linux/arm64
```

## 镜像缓存（ECR build-cache）

中国区 CodeBuild 无法稳定访问公共镜像站，构建依赖的三个镜像预先同步到账号内 ECR：

| ECR Repository | 来源镜像 | 用途 |
|---|---|---|
| `build-cache/binfmt` | `tonistiigi/binfmt:latest` | QEMU 多架构注册 |
| `build-cache/buildkit` | `moby/buildkit:buildx-stable-1` | BuildKit daemon |
| `build-cache/node` | `node:20-alpine`（amd64 + arm64）| 应用 base image |

**首次部署前**，需要从网络可达的机器执行一次预同步。以中国宁夏区、AWS profile `cn` 为例：

```bash
PROFILE="cn"
REGION="cn-northwest-1"
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
ECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com.cn"

aws ecr get-login-password --profile "$PROFILE" --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR"

# 创建 repo（已存在时忽略错误）
aws ecr create-repository --repository-name build-cache/binfmt   --profile "$PROFILE" --region "$REGION" 2>/dev/null || true
aws ecr create-repository --repository-name build-cache/buildkit  --profile "$PROFILE" --region "$REGION" 2>/dev/null || true
aws ecr create-repository --repository-name build-cache/node      --profile "$PROFILE" --region "$REGION" 2>/dev/null || true

# 同步 binfmt 和 buildkit
docker pull tonistiigi/binfmt:latest
docker pull moby/buildkit:buildx-stable-1
docker tag tonistiigi/binfmt:latest      "$ECR/build-cache/binfmt:latest"
docker tag moby/buildkit:buildx-stable-1 "$ECR/build-cache/buildkit:buildx-stable-1"
docker push "$ECR/build-cache/binfmt:latest"
docker push "$ECR/build-cache/buildkit:buildx-stable-1"

# 同步 node base image（imagetools create 完整复制多架构 manifest + blobs）
docker buildx imagetools create \
  --tag "$ECR/build-cache/node:20-alpine" \
  node:20-alpine
```

同步完成后，CodeBuild 全程从 ECR 内网拉取，构建时间约 **50 秒**（相比公共镜像站的 8+ 分钟）。

## 缓存镜像更新

`build-cache/*` 中的镜像不会自动更新，需要按需手动刷新。

**何时需要更新：**
- `node:20-alpine` 发布安全补丁（建议每月检查一次）
- 升级 Node 大版本（如从 20 切到 22）
- `binfmt` 或 `buildkit` 有重要 bug 修复

**更新 node base image：**

```bash
# 拉取最新版本并重新推送
docker pull node:20-alpine
docker buildx imagetools create \
  --tag "$ECR/build-cache/node:20-alpine" \
  node:20-alpine
```

升级大版本时，同步更新 `app/Dockerfile` 的 `ARG BASE_IMAGE` 默认值和 `infra/buildspec.yml` 中的 `BASE_IMAGE` 引用，以及 ECR repo 名称（如改为 `build-cache/node22`）。

**更新 binfmt / buildkit：**

```bash
docker pull tonistiigi/binfmt:latest
docker tag tonistiigi/binfmt:latest "$ECR/build-cache/binfmt:latest"
docker push "$ECR/build-cache/binfmt:latest"

docker pull moby/buildkit:buildx-stable-1
docker tag moby/buildkit:buildx-stable-1 "$ECR/build-cache/buildkit:buildx-stable-1"
docker push "$ECR/build-cache/buildkit:buildx-stable-1"
```

npm registry 仍使用 npmmirror，配置在 `.npmrc`：

```text
registry=https://registry.npmmirror.com/
```

## 输入参数

常用 CDK context 参数：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `codeCommitRepoName` | `multiarch-container-app` | CodeCommit 仓库名称 |
| `pipelineName` | `multiarch-codepipeline` | CodePipeline 名称 |
| `projectName` | `multiarch-codebuild` | CodeBuild project 名称 |
| `branch` | `main` | CodePipeline 监听的 CodeCommit 分支 |
| `imageRepoName` | `multiarch-app` | ECR repository 名称 |
| `imageTag` | `latest` | 推送的镜像 tag |
| `platforms` | `linux/amd64,linux/arm64` | buildx 构建平台 |

## 清理说明

ECR repository 默认由 CDK 保留，避免误删镜像。CodePipeline artifact bucket 设置为随 stack 删除；如果其中已有流水线产物，删除 stack 前需要先清空 bucket。
