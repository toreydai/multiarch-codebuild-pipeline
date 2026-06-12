# Multi-Architecture Code Pipeline

用 AWS CDK 创建 CodeCommit、CodePipeline、CodeBuild 和 ECR。代码推送到 CodeCommit 后，流水线自动用 Docker buildx 构建 `linux/amd64` + `linux/arm64` 镜像并推送到 ECR。

参考方案：
https://aws.amazon.com/cn/blogs/china/multi-architecture-container-image-build-pipeline-based-on-amazon-code-suite/

## 快速开始

```bash
npm install

AWS_REGION=cn-northwest-1 npx cdk deploy
```

部署后把当前代码推到 CDK 创建的 CodeCommit repo：

```bash
git remote add codecommit <CodeCommitCloneUrlHttp>
git push codecommit main
```

## 常用参数

```bash
npx cdk deploy \
  -c codeCommitRepoName=multiarch-container-app \
  -c pipelineName=multiarch-codepipeline \
  -c projectName=multiarch-codebuild \
  -c branch=main \
  -c imageRepoName=multiarch-app \
  -c imageTag=latest \
  -c platforms=linux/amd64,linux/arm64
```

## 结构

```text
.
├── app/      # 示例容器应用
├── infra/    # CDK + buildspec
├── docs/     # 架构和测试文档
├── cdk.json
└── package.json
```

`node_modules/` 和 `cdk.out/` 是本地产物，已在 `.gitignore` 中。

## 文档

- [架构文档](docs/architecture.md)
- [测试文档](docs/testing.md)

## License

MIT License. See [LICENSE](LICENSE) for details.

## 免责声明

本项目仅供学习与技术参考，不构成生产部署方案。运行过程中会创建 AWS 资源并产生费用，请在实验结束后及时清理。作者不对因使用本项目产生的任何费用或损失承担责任。本项目与 Amazon Web Services 无官方关联，相关服务的可用性与定价以 AWS 官方文档为准。生产环境使用前请根据实际需求进行安全评估与调整。
