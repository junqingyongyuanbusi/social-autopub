import { Module } from "@nestjs/common";
import { GenerationModule } from "../generation/generation.module";
import { PostizModule } from "../postiz/postiz.module";
import { NotionModule } from "../sources/notion/notion.module";
import { AccountsController } from "./accounts.controller";
import { MediaController } from "./media.controller";
import { PromptsController } from "./prompts.controller";
import { RoutingController } from "./routing.controller";
import { SourcesController } from "./sources.controller";
import { StatsController } from "./stats.controller";
import { UsersController } from "./users.controller";

@Module({
  imports: [PostizModule, NotionModule, GenerationModule],
  controllers: [
    AccountsController,
    MediaController,
    PromptsController,
    RoutingController,
    SourcesController,
    StatsController,
    UsersController,
  ],
})
export class AdminModule {}
