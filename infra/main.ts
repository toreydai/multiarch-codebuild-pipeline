#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

const app = new cdk.App();

function context(name: string, fallback: string): string {
  const value = app.node.tryGetContext(name);
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

class MultiarchStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const branch = context('branch', 'main');
    const codeCommitRepoName = context('codeCommitRepoName', 'multiarch-container-app');
    const pipelineName = context('pipelineName', 'multiarch-codepipeline');
    const projectName = context('projectName', 'multiarch-codebuild');
    const imageRepoName = context('imageRepoName', 'multiarch-app');
    const imageTag = context('imageTag', 'latest');
    const platforms = context('platforms', 'linux/amd64,linux/arm64');

    const sourceRepo = new codecommit.Repository(this, 'SourceRepo', {
      repositoryName: codeCommitRepoName,
      description: 'Source repository for multi-architecture container image builds.',
    });

    const imageRepo = new ecr.Repository(this, 'ImageRepo', {
      repositoryName: imageRepoName,
      imageScanOnPush: true,
      lifecycleRules: [
        { maxImageCount: 20, tagPrefixList: [imageTag] },
        { maxImageAge: cdk.Duration.days(30), tagStatus: ecr.TagStatus.UNTAGGED },
      ],
    });

    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName,
      description: 'Build and push linux/amd64 and linux/arm64 images to ECR.',
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infra/buildspec.yml'),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      environmentVariables: {
        IMAGE_REPO_NAME: { value: imageRepoName },
        IMAGE_TAG: { value: imageTag },
        PLATFORMS: { value: platforms },
      },
      timeout: cdk.Duration.minutes(60),
    });

    imageRepo.grantPullPush(buildProject);
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));
    // Allow pulling pre-synced build tool images (binfmt, buildkit) from ECR
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: [
        `arn:${cdk.Aws.PARTITION}:ecr:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:repository/build-cache/binfmt`,
        `arn:${cdk.Aws.PARTITION}:ecr:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:repository/build-cache/buildkit`,
        `arn:${cdk.Aws.PARTITION}:ecr:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:repository/build-cache/node`,
      ],
    }));

    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');

    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName,
      pipelineType: codepipeline.PipelineType.V2,
      artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new actions.CodeCommitSourceAction({
              actionName: 'CodeCommit',
              repository: sourceRepo,
              branch,
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new actions.CodeBuildAction({
              actionName: 'BuildMultiArchImage',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
    });

    new cdk.CfnOutput(this, 'CodeCommitRepositoryName', { value: sourceRepo.repositoryName });
    new cdk.CfnOutput(this, 'CodeCommitCloneUrlHttp', { value: sourceRepo.repositoryCloneUrlHttp });
    new cdk.CfnOutput(this, 'PipelineName', { value: pipelineName });
    new cdk.CfnOutput(this, 'ProjectName', { value: buildProject.projectName });
    new cdk.CfnOutput(this, 'RepositoryUri', { value: imageRepo.repositoryUri });
    new cdk.CfnOutput(this, 'ImageUri', { value: `${imageRepo.repositoryUri}:${imageTag}` });
  }
}

new MultiarchStack(app, 'MultiarchCodebuildStack');
