#!/bin/bash
if [ "$1" == "local" ]; then
    liquibase --defaultsFile=liquibase.local.properties update
elif [ "$1" == "remote" ]; then
    liquibase --defaultsFile=liquibase.properties update
else
    echo "Usage: $0 [local|remote]"
fi