#!/usr/bin/env bun
import { currentRepository } from "../../../script/publish-plan"
import { preflightForkNpmOwnership } from "./publish-ownership"

const result = await preflightForkNpmOwnership(currentRepository())
console.log(`npm ownership preflight passed for ${result.packages.length} fork packages`)
