# 测试文档

本文覆盖本地校验、CDK 合成、部署、推送到 CodeCommit、流水线触发和 ECR manifest 验证。

## 1. 本地静态检查

```bash
npm install
npm run build
npx cdk synth
```

可选：对合成后的 CloudFormation 模板做 lint：

```bash
cfn-lint cdk.out/MultiarchCodebuildStack.template.json
```

## 2. 部署

```bash
AWS_REGION=cn-northwest-1 npx cdk deploy
```

部署完成后记录 CloudFormation Outputs：

- `CodeCommitRepositoryName`
- `CodeCommitCloneUrlHttp`
- `PipelineName`
- `ProjectName`
- `RepositoryUri`
- `ImageUri`

## 3. 推送源码到 CodeCommit

添加 CodeCommit remote：

```bash
git remote add codecommit <CodeCommitCloneUrlHttp>
```

推送当前分支到流水线监听分支：

```bash
git push codecommit HEAD:main
```

如果本地分支已经是 `main`，也可以执行：

```bash
git push codecommit main
```

## 4. 查看流水线和构建状态

查看 pipeline 状态：

```bash
aws codepipeline get-pipeline-state \
  --name multiarch-codepipeline \
  --region cn-northwest-1
```

查看最近一次 CodeBuild：

```bash
BUILD_ID=$(aws codebuild list-builds-for-project \
  --project-name multiarch-codebuild \
  --sort-order DESCENDING \
  --query 'ids[0]' \
  --output text \
  --region cn-northwest-1)

aws codebuild batch-get-builds \
  --ids "$BUILD_ID" \
  --query 'builds[0].{status:buildStatus,logs:logs.deepLink}' \
  --output table \
  --region cn-northwest-1
```

成功标准：

- Pipeline 的 Source 和 Build stage 均成功
- CodeBuild 状态是 `SUCCEEDED`
- 日志中能看到 `docker buildx build`
- 日志中能看到 `Image pushed`

## 5. 验证多架构镜像

登录 ECR：

```bash
aws ecr get-login-password --region cn-northwest-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.cn-northwest-1.amazonaws.com.cn
```

检查 manifest：

```bash
docker buildx imagetools inspect <ImageUri>
```

成功标准：

```text
linux/amd64
linux/arm64
```

两个平台都应出现在输出中。

也可以用 AWS CLI 查看 ECR image manifest media type：

```bash
aws ecr describe-images \
  --repository-name multiarch-app \
  --image-ids imageTag=latest \
  --query 'imageDetails[0].imageManifestMediaType' \
  --output text \
  --region cn-northwest-1
```

## 6. 清理

**步骤一：清空 artifact bucket**（有流水线产物时必须先清空，否则 stack 删除会失败）

```bash
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name MultiarchCodebuildStack \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" \
  --output text --region cn-northwest-1)

# 若 bucket 名称不在 Outputs 中，可通过以下命令查找
BUCKET=$(aws s3 ls | grep multiarchcodebuildstack-artifactbucket | awk '{print $3}')

aws s3 rm "s3://${BUCKET}" --recursive --region cn-northwest-1
```

**步骤二：删除 CDK stack**

```bash
AWS_REGION=cn-northwest-1 npx cdk destroy
```

**步骤三：删除应用镜像 ECR repo**（stack 删除后仍保留，需手动清理）

```bash
aws ecr delete-repository \
  --repository-name multiarch-app \
  --force \
  --region cn-northwest-1
```

**步骤四：删除 build-cache ECR repo**（stack 之外手动创建，需单独清理）

```bash
for repo in build-cache/binfmt build-cache/buildkit build-cache/node; do
  aws ecr delete-repository \
    --repository-name "$repo" \
    --force \
    --region cn-northwest-1
done
```

## 常见问题

`git push codecommit` 权限失败：

确认当前 AWS profile 有 CodeCommit Git 凭证，或使用 AWS CLI credential helper：

```bash
git config --global credential.helper '!aws codecommit credential-helper $@'
git config --global credential.UseHttpPath true
```

`docker buildx build` 拉基础镜像失败：

构建依赖的三个镜像（binfmt、buildkit、node base image）默认从账号内 ECR `build-cache/*` 拉取，需要在首次部署前完成预同步。详见 [架构文档 — 镜像缓存（ECR build-cache）](architecture.md#镜像缓存ecr-build-cache)。

如果预同步已完成但拉取仍失败，检查 CodeBuild IAM role 是否有 `build-cache/binfmt`、`build-cache/buildkit`、`build-cache/node` 三个 repo 的 pull 权限（`ecr:BatchGetImage` 等）。CDK 代码中已声明这些权限，重新部署 stack 即可自动创建。

## CI（GitHub Actions）

`.github/workflows/validate.yml` 在每次 push 和 PR 时自动执行：

1. `app/` 依赖安装（`npm install --omit=dev`）
2. CDK 依赖安装（`npm install`）
3. TypeScript 编译（`npm run build`）
4. CDK 模板合成（`npx cdk synth`）

CI 不需要 AWS 凭证——CDK stack 使用 `cdk.Aws.REGION` / `cdk.Aws.ACCOUNT_ID` 伪参数，合成阶段无需解析真实账号。CI 的目的是保证代码可编译、模板可合成，不覆盖实际 AWS 部署验证。
