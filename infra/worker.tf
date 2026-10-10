# ---------- Campaign worker (ECS Fargate) ----------
# Same image as the API, started with RUN_MODE=worker. It runs the campaign sender every second with
# always-on CPU, so scheduled and running campaigns don't depend on dashboard traffic.
# One task; a unique index on (campaign, contact) prevents double sends during a deploy overlap.

resource "aws_ecs_cluster" "main" {
  name = var.name
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.name}-worker"
  retention_in_days = 14
}

resource "aws_iam_role" "worker_execution" {
  name = "${var.name}-worker-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "worker_execution" {
  role       = aws_iam_role.worker_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "worker_secrets" {
  role = aws_iam_role.worker_execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.app.arn }]
  })
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.worker_execution.arn

  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${aws_ecr_repository.api.repository_url}:latest"
    essential = true
    environment = [
      { name = "RUN_MODE", value = "worker" },
      { name = "TC_PROVIDER", value = var.tc_provider },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
      { name = "API_KEYS", valueFrom = "${aws_secretsmanager_secret.app.arn}:API_KEYS::" },
      { name = "TC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:TC_API_KEY::" },
      { name = "TC_WEBHOOK_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:TC_WEBHOOK_SECRET::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "${var.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Stop the old task before starting the new one on deploys
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true # default VPC has no NAT; needed to pull the image and call Truecaller
  }

  depends_on = [aws_iam_role_policy_attachment.worker_execution, aws_iam_role_policy.worker_secrets]
}
