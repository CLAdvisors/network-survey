# Liquibase command script generated by Terraform

$liquibaseArgs = @(
    "--url=jdbc:postgresql://terraform-20241204194744041200000001.cb4kmcse0a7d.us-east-1.rds.amazonaws.com:5432/ONA",
    "--username=DbAdmin",
    "--password=password!",
    "--changeLogFile=changelogs/master-changelog.xml",
    "--logLevel=info"
)

# Append any additional arguments passed to the script
$liquibaseArgs += $args

# Run Liquibase with the specified arguments
& liquibase @liquibaseArgs
