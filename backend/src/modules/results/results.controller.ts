import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { pageLimit } from '../../common/pagination.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { User } from '../users/users.repository.js';
import { ResultsService } from './results.service.js';

const pollId = z.uuid();
const resultsQuery = z.object({
  breakdown: z.enum(['none', 'faculty', 'year']).default('none'),
});
const responsesQuery = z.object({
  cursor: z.string().max(300).optional(),
  limit: pageLimit(200, 50),
});
const textQuery = z.object({
  elementId: z.uuid(),
  cursor: z.string().max(200).optional(),
  limit: pageLimit(100, 50),
});

@Controller('polls/:id/results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  /** Polled every few seconds by the results screen; answers 304 when unchanged. */
  @Get()
  async get(
    @CurrentUser() user: User,
    @Param('id', { schema: pollId }) id: string,
    @Query({ schema: resultsQuery }) q: z.infer<typeof resultsQuery>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const { body, etag } = await this.results.results(user, id, q.breakdown);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    res.type('application/json').send(body);
  }

  /** "ระบุคนส่ง": each respondent's id with their answers (owner and admins). */
  @Get('responses')
  responses(
    @CurrentUser() user: User,
    @Param('id', { schema: pollId }) id: string,
    @Query({ schema: responsesQuery }) q: z.infer<typeof responsesQuery>,
  ) {
    return this.results.responses(user, id, q.cursor, q.limit);
  }

  @Get('responses.csv')
  async responsesCsv(
    @CurrentUser() user: User,
    @Param('id', { schema: pollId }) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.results.responsesCsv(user, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="poll-${id}-responses.csv"`,
    );
    res.type('text/csv; charset=utf-8').send(csv);
  }

  @Get('text')
  text(
    @CurrentUser() user: User,
    @Param('id', { schema: pollId }) id: string,
    @Query({ schema: textQuery }) q: z.infer<typeof textQuery>,
  ) {
    return this.results.textAnswers(user, id, q.elementId, q.cursor, q.limit);
  }
}
